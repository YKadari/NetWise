"""PDF route regressions. All provider calls in this file are mocked."""
import asyncio
from io import BytesIO
import threading

import httpx
import pytest
from fastapi.testclient import TestClient
from pypdf import PdfReader, PdfWriter

from backend.app.api import lease_routes as routes
from backend.app.lease_extraction.models import CandidateTerm, LeaseExtraction
from backend.app.lease_extraction.provider import GeminiOutputError, GeminiProviderError, GeminiQuotaError
from backend.app.main import app
from scripts.diagnose_pdf_extraction import synthetic_pdf


@pytest.fixture(autouse=True)
def isolated_extraction(monkeypatch):
    monkeypatch.setenv('NESTWISE_ENV', 'test')
    monkeypatch.setenv('NESTWISE_ENABLE_PUBLIC_GEMINI', 'true')
    monkeypatch.setenv('GEMINI_API_KEY', 'synthetic-only')
    routes._REQUEST_TIMES.clear()
    yield
    routes._REQUEST_TIMES.clear()


def extraction():
    return LeaseExtraction(terms=[CandidateTerm(field_id='monthly_base_rent', value=1500,
        source_excerpt='Monthly base rent is $1500.', status='explicit')])


def test_text_pdf_passes_original_bytes_and_verifies_page(monkeypatch):
    payload = synthetic_pdf()
    assert 'Monthly base rent is $1500.' in PdfReader(BytesIO(payload)).pages[0].extract_text()
    seen = []
    def provider(data, *, is_pdf=False):
        seen.append((data, is_pdf))
        return extraction()
    monkeypatch.setattr(routes, 'extract_with_gemini', provider)
    with TestClient(app) as client:
        result = client.post('/api/lease/extract-pdf', files={'file': ('sample.pdf', payload, 'application/pdf')})
    assert result.status_code == 200
    assert seen == [(payload, True)]
    assert result.json()['source_type'] == 'pdf'
    assert result.json()['review_required'] is True
    assert result.json()['terms'][0]['evidence_verification'] == 'verified_page'
    assert result.json()['terms'][0]['page_reference'] == 1
    assert 'evaluation' not in result.json()


@pytest.mark.parametrize(('kind', 'expected'), [('empty', 422), ('signature', 415), ('malformed', 422), ('encrypted', 422), ('pages', 422), ('oversize', 413), ('mime', 415)])
def test_pdf_rejections_never_contact_provider(monkeypatch, kind, expected):
    def forbidden(*args, **kwargs):
        pytest.fail('Invalid PDF reached the provider')
    monkeypatch.setattr(routes, 'extract_with_gemini', forbidden)
    payload = synthetic_pdf()
    if kind == 'empty': payload = b''
    if kind == 'signature': payload = b'not a pdf'
    if kind == 'malformed': payload = b'%PDF-1.7\ninvalid'
    if kind == 'oversize': payload = b'%PDF-' + b' ' * routes.MAX_PDF_BYTES
    if kind in ('encrypted', 'pages'):
        writer = PdfWriter()
        for _ in range(81 if kind == 'pages' else 1): writer.add_blank_page(width=72, height=72)
        if kind == 'encrypted': writer.encrypt('synthetic-password')
        buffer = BytesIO()
        writer.write(buffer)
        payload = buffer.getvalue()
    with TestClient(app) as client:
        result = client.post('/api/lease/extract-pdf', files={'file': ('sample.pdf', payload, 'text/plain' if kind == 'mime' else 'application/pdf')})
    assert result.status_code == expected


@pytest.mark.parametrize(('error', 'expected'), [(TimeoutError, 504), (GeminiOutputError, 502), (GeminiProviderError, 502), (GeminiQuotaError, 429)])
def test_pdf_provider_errors_are_distinct_and_sanitized(monkeypatch, error, expected):
    def fail(*args, **kwargs): raise error('private-document-and-secret-marker')
    monkeypatch.setattr(routes, 'extract_with_gemini', fail)
    with TestClient(app) as client:
        response = client.post('/api/lease/extract-pdf', files={'file': ('sample.pdf', synthetic_pdf(), 'application/pdf')})
    assert response.status_code == expected
    assert 'private-document-and-secret-marker' not in response.text


def test_pdf_provider_does_not_block_other_requests(monkeypatch):
    entered, release = threading.Event(), threading.Event()
    def slow_provider(*args, **kwargs):
        entered.set()
        if not release.wait(3): raise RuntimeError('test worker timed out')
        return extraction()
    monkeypatch.setattr(routes, 'extract_with_gemini', slow_provider)
    async def requests():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            pending = asyncio.create_task(client.post('/api/lease/extract-pdf', files={'file': ('sample.pdf', synthetic_pdf(), 'application/pdf')}))
            try:
                assert await asyncio.to_thread(entered.wait, 2)
                assert not pending.done()
                response = await asyncio.wait_for(client.get('/api/lease/status'), timeout=1)
                assert response.status_code == 200
                assert not pending.done()
            finally:
                release.set()
            assert (await pending).status_code == 200
    asyncio.run(requests())


def test_sdk_pdf_part_contains_original_bytes(monkeypatch):
    from google import genai
    from backend.app.lease_extraction import provider
    monkeypatch.setattr(provider, 'get_api_key', lambda: 'synthetic-only')
    monkeypatch.setattr(provider, 'get_model', lambda: 'synthetic-model')
    captured = {}
    class FakeModels:
        def generate_content(self, **kwargs):
            captured.update(kwargs)
            return type('Response', (), {'text': extraction().model_dump_json()})()
    class FakeClient:
        def __init__(self, **kwargs):
            captured['timeout'] = kwargs['http_options'].timeout
            self.models = FakeModels()
    monkeypatch.setattr(genai, 'Client', FakeClient)
    payload = synthetic_pdf()
    provider.extract_with_gemini(payload, is_pdf=True)
    assert captured['contents'][1].inline_data.data == payload
    assert captured['contents'][1].inline_data.mime_type == 'application/pdf'
    assert captured['timeout'] == 30_000
    assert captured['config'].response_json_schema == provider._gemini_response_schema()
