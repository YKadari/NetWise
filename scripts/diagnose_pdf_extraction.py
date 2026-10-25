"""One opt-in synthetic PDF endpoint request; never prints credentials or terms."""
from __future__ import annotations

import argparse
from importlib.metadata import version
from io import BytesIO
import json
import logging
import os
import time


def synthetic_pdf() -> bytes:
    from pypdf import PdfWriter
    from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject

    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)
    font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
    page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
    stream = DecodedStreamObject()
    stream.set_data(b'BT /F1 12 Tf 50 730 Td (Synthetic demo lease. Rental name: Sample Home.) Tj 0 -20 Td (Monthly base rent is $1500. The lease term is 12 months.) Tj 0 -20 Td (The refundable security deposit is $1000.) Tj ET')
    page[NameObject('/Contents')] = writer._add_object(stream)
    buffer = BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live', action='store_true', help='Make exactly one synthetic PDF extraction request using local configuration.')
    args = parser.parse_args()
    if not args.live:
        parser.error('Use --live only when you intend to consume one Gemini request.')
    from backend.app.lease_extraction.config import provider_status
    if not provider_status()['service_ready']:
        print('Local extraction is not ready; no request made.')
        return
    os.environ['NESTWISE_GEMINI_DIAGNOSTICS'] = '1'
    logging.basicConfig(level=logging.CRITICAL)
    for name in ('backend.app.lease_extraction.provider', 'backend.app.api.lease_routes'):
        logger = logging.getLogger(name)
        logger.setLevel(logging.INFO)
        logger.addHandler(logging.StreamHandler())
        logger.propagate = False
    from fastapi.testclient import TestClient
    from backend.app.main import app
    from backend.app.lease_extraction.models import LeaseDraft
    payload = synthetic_pdf()
    started = time.perf_counter()
    with TestClient(app) as client:
        files = {'file': ('synthetic.pdf', payload, 'application/pdf')}
        inspected = client.post('/api/pdf-redaction/inspect', files=files)
        if inspected.status_code != 200:
            print(json.dumps({'live_request_made': False, 'inspect_status': inspected.status_code})); return
        inspection = inspected.json()
        ids = [item['id'] for item in inspection['candidates']]
        exported = client.post('/api/pdf-redaction/export', files=files, data={
            'document_digest': inspection['document_digest'], 'candidate_ids': ids,
            'acknowledge_no_candidates': 'true' if not ids else 'false'})
        if exported.status_code != 200:
            print(json.dumps({'live_request_made': False, 'export_status': exported.status_code})); return
        response = client.post('/api/lease/extract-redacted-pdf', files=files, data={'approval': json.dumps({
            'document_digest': inspection['document_digest'], 'approved_pdf_digest': exported.headers['x-redacted-pdf-sha256'],
            'candidate_ids': ids, 'acknowledge_no_candidates': not ids, 'consent_to_gemini': True})})
    report = {'sdk': version('google-genai'), 'pdf_bytes': len(payload), 'http_status': response.status_code, 'elapsed_ms': round((time.perf_counter() - started) * 1000)}
    if response.status_code == 200:
        draft = LeaseDraft.model_validate(response.json())
        terms = {term.field_id: term for term in draft.terms}
        report['valid_draft'] = True
        report['rent_and_duration_match'] = terms.get('monthly_base_rent') is not None and terms['monthly_base_rent'].value == 1500 and terms.get('lease_term_months') is not None and terms['lease_term_months'].value == 12
        report['verified_page_terms'] = sum(term.evidence_verification == 'verified_page' for term in draft.terms)
    print(json.dumps(report))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(f'Diagnostic stopped: {type(exc).__name__}. No raw error details printed.')
        raise SystemExit(1) from None
