from __future__ import annotations

from io import BytesIO

import pytest
import pymupdf
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, NameObject
from reportlab.pdfgen.canvas import Canvas

from backend.app.pdf_redaction.intake import MAX_PDF_BYTES, inspect_upload
from backend.app.pdf_redaction.detection import detect_candidates
from backend.app.pdf_redaction.redact import inspect_pdf, redact_pdf
from backend.app.main import app


def make_pdf(*, rotation: int = 0, image_only: bool = False, annotation: bool = False) -> bytes:
    document = pymupdf.open()
    page = document.new_page()
    if image_only:
        pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 3, 3), 0)
        pixmap.clear_with(240)
        page.insert_image(page.rect, pixmap=pixmap)
    else:
        page.insert_text((72, 72), "Tenant: Jordan Sample")
        page.insert_text((72, 100), "Applicant email: jordan.sample@example.test")
        page.insert_text((72, 128), "Phone: 312-555-0198")
        page.insert_text((72, 156), "SSN: 123-45-6789")
        page.insert_text((72, 184), "Account Number: 987654321012")
        page.insert_text((72, 212), "Monthly rent: $1,600; refundable security deposit: $800")
        page.insert_text((72, 240), "Application fee: $100; lease term: 12 months")
        page.insert_text((72, 268), "Guarantor: Taylor Example")
        page.insert_text((72, 296), "Typed Signature of Tenant: Jordan Sample")
    if annotation:
        page.add_text_annot((70, 340), "synthetic annotation")
    if rotation:
        page.set_rotation(rotation)
    document.set_metadata({"title": "Jordan Sample private test", "author": "jordan.sample@example.test"})
    data = document.tobytes()
    document.close()
    return data


def make_two_page_text_pdf(generator: str) -> bytes:
    pages = [
        ("Tenant: Morgan Reader", "Email: morgan.reader@example.test", "Monthly rent: $1,600"),
        ("Guarantor: Casey Example", "Email: casey.example@example.test", "Refundable security deposit: $800"),
    ]
    if generator == "reportlab":
        buffer = BytesIO()
        canvas = Canvas(buffer, pagesize=(595, 842))
        canvas.setTitle("SYNTHETIC_PRIVATE_METADATA")
        for lines in pages:
            for index, line in enumerate(lines):
                canvas.drawString(72, 760 - index * 28, line)
            canvas.showPage()
        canvas.save()
        return buffer.getvalue()
    assert generator == "pymupdf"
    document = pymupdf.open()
    for lines in pages:
        page = document.new_page()
        for index, line in enumerate(lines):
            page.insert_text((72, 72 + index * 28), line)
    document.set_metadata({"title": "SYNTHETIC_PRIVATE_METADATA"})
    data = document.tobytes()
    document.close()
    return data


def with_embedded_associated_file(data: bytes) -> bytes:
    writer = PdfWriter()
    writer.append_pages_from_reader(PdfReader(BytesIO(data), strict=True))
    writer.add_attachment("SYNTHETIC_PRIVATE_ATTACHMENT.txt", b"SYNTHETIC_PRIVATE_ATTACHMENT_CONTENT")
    file_spec = writer._root_object["/Names"]["/EmbeddedFiles"]["/Names"][1]
    writer._root_object[NameObject("/AF")] = ArrayObject([file_spec])
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


@pytest.mark.parametrize("generator", ["reportlab", "pymupdf"])
def test_clean_two_page_generator_pdf_is_accepted_and_genuinely_redacted(generator):
    data = make_two_page_text_pdf(generator)
    inspected = inspect_pdf(data, "sample.pdf", "application/pdf")
    assert inspected["page_count"] == 2
    email_ids = [item["id"] for item in inspected["candidates"] if item["category"] == "email"]
    assert len(email_ids) == 2
    output = redact_pdf(data, "sample.pdf", "application/pdf", inspected["document_digest"], email_ids)
    document = pymupdf.open(stream=output, filetype="pdf")
    try:
        assert document.page_count == 2
        text = "\n".join(page.get_text() for page in document)
        assert "morgan.reader@example.test" not in text and "casey.example@example.test" not in text
        assert "$1,600" in text and "$800" in text
        assert document.embfile_count() == 0 and not document.is_form_pdf
    finally:
        document.close()


@pytest.mark.parametrize("generator", ["reportlab", "pymupdf"])
def test_text_only_pages_with_embedded_associated_file_are_rejected_with_safe_diagnostics(generator, monkeypatch, caplog):
    data = with_embedded_associated_file(make_two_page_text_pdf(generator))
    document = pymupdf.open(stream=data, filetype="pdf")
    try:
        assert document.embfile_count() == 1
        assert document.xref_get_key(document.pdf_catalog(), "AF")[0] == "array"
        assert not document.is_form_pdf
        for page in document:
            assert page.get_text().strip()
            assert not page.get_images() and not page.get_drawings() and not page.get_links() and not page.get_xobjects()
            assert not page.first_annot and not page.first_widget
    finally:
        document.close()
    monkeypatch.setenv("NESTWISE_PDF_DIAGNOSTICS", "1")
    with caplog.at_level("WARNING", logger="backend.app.pdf_redaction.intake"):
        with pytest.raises(HTTPException) as error:
            inspect_pdf(data, "SYNTHETIC_PRIVATE_FILENAME.pdf", "application/pdf")
    assert error.value.status_code == 422
    assert "embedded attachments or associated files" in error.value.detail
    assert "category=embedded_attachments" in caplog.text
    assert '"embedded_files":1' in caplog.text
    assert '"forms":false' in caplog.text
    assert '"page_count":2' in caplog.text
    for private_value in ("SYNTHETIC_PRIVATE_FILENAME", "SYNTHETIC_PRIVATE_ATTACHMENT", "Morgan Reader", "example.test", "$1,600"):
        assert private_value not in caplog.text and private_value not in error.value.detail


def test_pdf_structural_diagnostics_are_opt_in(monkeypatch, caplog):
    monkeypatch.delenv("NESTWISE_PDF_DIAGNOSTICS", raising=False)
    with pytest.raises(HTTPException):
        inspect_pdf(with_embedded_associated_file(make_pdf()), "sample.pdf", "application/pdf")
    assert not any(record.name == "backend.app.pdf_redaction.intake" for record in caplog.records)


def test_detection_finds_labeled_identifiers_without_proposing_rent_amounts():
    data = make_pdf()
    inspected = inspect_pdf(data, "sample.pdf", "application/pdf")
    candidates = inspected["candidates"]
    categories = {item["category"] for item in candidates}
    assert {"identity_name", "email", "phone", "personal_id", "account", "signature"}.issubset(categories)
    assert all(item["review_required"] is True for item in candidates)
    assert all("Jordan" not in str(item) and "jordan.sample" not in str(item) and "123-45" not in str(item) for item in candidates)
    assert all("$1,600" not in str(item) and "$800" not in str(item) and "$100" not in str(item) for item in candidates)
    assert inspected["page_count"] == 1
    assert inspected["pages"][0]["page_number"] == 1


def make_signature_pdf(signature_label: str | None = None) -> bytes:
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 72), "Prepared by Morgan Reader")
    page.insert_text((72, 100), "Monthly rent: $1,600; refundable security deposit: $800")
    if signature_label is not None:
        page.insert_text((72, 128), f"{signature_label}: Avery Signer")
    data = document.tobytes()
    document.close()
    return data


@pytest.mark.parametrize("label", ["Signature", "Signature of Tenant", "Typed Signature of Tenant"])
def test_explicit_typed_signature_keeps_its_category_and_exact_name_geometry(label):
    document = pymupdf.open(stream=make_signature_pdf(label), filetype="pdf")
    try:
        candidates = detect_candidates(document)
        signatures = [item for item in candidates if item["category"] == "signature"]
        assert len(signatures) == 1
        signature = signatures[0]
        assert signature["match_text"] == "Avery Signer"
        assert document[0].get_textbox(signature["rect"]).strip() == "Avery Signer"
        assert len(candidates) == 1  # The overlapping identity rule must not create a duplicate.
    finally:
        document.close()


def test_unrelated_name_and_financial_amounts_are_not_signature_candidates():
    inspected = inspect_pdf(make_signature_pdf(), "sample.pdf", "application/pdf")
    assert inspected["candidates"] == []


def test_typed_signature_export_removes_name_and_preserves_unrelated_financial_terms():
    data = make_signature_pdf("Typed Signature of Tenant")
    inspected = inspect_pdf(data, "sample.pdf", "application/pdf")
    signature_ids = [item["id"] for item in inspected["candidates"] if item["category"] == "signature"]
    assert len(signature_ids) == 1
    output = redact_pdf(data, "sample.pdf", "application/pdf", inspected["document_digest"], signature_ids)
    result = pymupdf.open(stream=output, filetype="pdf")
    try:
        text = result[0].get_text()
        assert "Avery" not in text and "Signer" not in text
        assert "Prepared by Morgan Reader" in text
        assert "$1,600" in text and "$800" in text
    finally:
        result.close()


def test_export_permanently_redacts_selected_text_preserves_finances_and_clears_metadata():
    data = make_pdf()
    inspected = inspect_pdf(data, "sample.pdf", "application/pdf")
    candidates = inspected["candidates"]
    selected = [item["id"] for item in candidates if item["category"] in {"email", "identity_name", "signature"}]
    output = redact_pdf(data, "sample.pdf", "application/pdf", inspected["document_digest"], selected)
    result = pymupdf.open(stream=output, filetype="pdf")
    try:
        text = result[0].get_text()
        assert "jordan.sample@example.test" not in text
        assert "Jordan Sample" not in text
        assert "$1,600" in text and "$800" in text and "$100" in text
        assert not result.metadata["title"] and not result.metadata["author"]
        assert len(output) > 0 and result.page_count == 1
    finally:
        result.close()


def test_rotated_page_candidate_coordinates_can_be_exported():
    data = make_pdf(rotation=90)
    inspected = inspect_pdf(data, "rotated.pdf", "application/pdf")
    assert inspected["pages"][0]["width"] > inspected["pages"][0]["height"]
    candidate = next(item for item in inspected["candidates"] if item["category"] == "email")
    output = redact_pdf(data, "rotated.pdf", "application/pdf", inspected["document_digest"], [candidate["id"]])
    result = pymupdf.open(stream=output, filetype="pdf")
    try:
        assert "jordan.sample@example.test" not in result[0].get_text()
        assert "$1,600" in result[0].get_text()
    finally:
        result.close()


@pytest.mark.parametrize("payload", [b"not a pdf", b"%PDF-broken and truncated"])
def test_non_pdf_and_malformed_pdf_rejected(payload):
    with pytest.raises(HTTPException):
        inspect_pdf(payload, "sample.pdf", "application/pdf")


def test_incorrect_pdf_media_type_and_extension_rejected():
    data = make_pdf()
    for filename, content_type in (("sample.txt", "application/pdf"), ("sample.pdf", "application/octet-stream")):
        with pytest.raises(HTTPException) as error:
            inspect_pdf(data, filename, content_type)
        assert error.value.status_code == 415


def test_image_only_and_annotation_pdf_rejected():
    for data in (make_pdf(image_only=True), make_pdf(annotation=True)):
        with pytest.raises(HTTPException):
            inspect_pdf(data, "sample.pdf", "application/pdf")


def test_embedded_attachment_pdf_rejected():
    document = pymupdf.open(stream=make_pdf(), filetype="pdf")
    document.embfile_add("note.txt", b"synthetic attachment")
    data = document.tobytes()
    document.close()
    with pytest.raises(HTTPException):
        inspect_pdf(data, "sample.pdf", "application/pdf")


def test_multiline_sensitive_identifier_that_cannot_be_mapped_is_rejected():
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 72), "Phone:")
    page.insert_text((72, 100), "312-555-0198")
    data = document.tobytes()
    document.close()
    with pytest.raises(HTTPException) as error:
        inspect_pdf(data, "sample.pdf", "application/pdf")
    assert error.value.status_code == 422


def test_encrypted_and_oversized_pdf_rejected():
    source = make_pdf()
    encrypted = pymupdf.open(stream=source, filetype="pdf")
    encrypted_bytes = encrypted.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="owner", user_pw="user")
    encrypted.close()
    with pytest.raises(HTTPException):
        inspect_pdf(encrypted_bytes, "sample.pdf", "application/pdf")
    with pytest.raises(HTTPException) as too_large:
        inspect_upload(b"%PDF-" + b"x" * MAX_PDF_BYTES, "sample.pdf", "application/pdf")
    assert too_large.value.status_code == 413


def test_inspect_route_and_export_route_are_no_store_and_do_not_call_gemini(monkeypatch):
    data = make_pdf()
    import backend.app.api.lease_routes as lease_routes

    def forbidden(*_args, **_kwargs):
        raise AssertionError("PDF redaction must not invoke Gemini")

    monkeypatch.setattr(lease_routes, "extract_with_gemini", forbidden)
    with TestClient(app) as client:
        inspected_response = client.post("/api/pdf-redaction/inspect", files={"file": ("sample.pdf", data, "application/pdf")})
        assert inspected_response.status_code == 200, inspected_response.text
        inspected = inspected_response.json()
        assert inspected_response.headers["cache-control"].startswith("no-store")
        selected = next(item["id"] for item in inspected["candidates"] if item["category"] == "email")
        export_response = client.post("/api/pdf-redaction/export", files={
            "file": ("sample.pdf", data, "application/pdf"),
        }, data={"document_digest": inspected["document_digest"], "candidate_ids": selected})
    assert export_response.status_code == 200, export_response.text
    assert export_response.headers["content-type"].startswith("application/pdf")
    assert "attachment" in export_response.headers["content-disposition"]
    assert export_response.headers["cache-control"].startswith("no-store")
    result = pymupdf.open(stream=export_response.content, filetype="pdf")
    try:
        assert "jordan.sample@example.test" not in result[0].get_text()
    finally:
        result.close()


def test_invalid_selection_empty_selection_and_changed_document_are_rejected():
    data = make_pdf()
    inspected = inspect_pdf(data, "sample.pdf", "application/pdf")
    for ids in ([], ["not-a-candidate"], [inspected["candidates"][0]["id"], inspected["candidates"][0]["id"]]):
        with pytest.raises(HTTPException):
            redact_pdf(data, "sample.pdf", "application/pdf", inspected["document_digest"], ids)
    with pytest.raises(HTTPException) as changed:
        redact_pdf(data + b" ", "sample.pdf", "application/pdf", inspected["document_digest"], [inspected["candidates"][0]["id"]])
    assert changed.value.status_code == 409


def test_server_rejects_out_of_page_candidate_geometry(monkeypatch):
    import backend.app.pdf_redaction.redact as redaction

    data = make_pdf()
    inspected = inspect_pdf(data, "sample.pdf", "application/pdf")
    monkeypatch.setattr(redaction, "detect_candidates", lambda _doc: [{
        "candidate_id": "region-0001", "page_index": 0, "match_text": "private",
        "rect": pymupdf.Rect(900, 900, 950, 950), "display_rect": pymupdf.Rect(900, 900, 950, 950),
    }])
    with pytest.raises(HTTPException) as error:
        redact_pdf(data, "sample.pdf", "application/pdf", inspected["document_digest"], ["region-0001"])
    assert error.value.status_code == 422


def test_verification_failure_blocks_download(monkeypatch):
    import backend.app.pdf_redaction.redact as redaction

    data = make_pdf()
    inspected = inspect_pdf(data, "sample.pdf", "application/pdf")
    selected = next(item["id"] for item in inspected["candidates"] if item["category"] == "email")
    monkeypatch.setattr(redaction, "_verify_redacted_output", lambda *_args: (_ for _ in ()).throw(ValueError("synthetic failure")))
    with pytest.raises(HTTPException) as error:
        redact_pdf(data, "sample.pdf", "application/pdf", inspected["document_digest"], [selected])
    assert error.value.status_code == 422
    assert "no file was returned" in error.value.detail
