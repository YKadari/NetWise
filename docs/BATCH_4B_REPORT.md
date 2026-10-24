# Batch 4B: lease extraction and human review

## Scope and implementation

Batch 4B adds backend-only, ephemeral lease extraction and confirmation. It does not add a frontend, database, account system, stress testing, or changes to the housing algorithms. The existing Batch 4A rental calculation remains the only financial evaluator.

Added `backend/app/lease_extraction/{__init__.py,config.py,models.py,provider.py,workflow.py}`, `backend/app/api/lease_routes.py`, `tests/test_lease_extraction.py`, `.env.example`, and this report. Updated `backend/app/main.py`, `backend/app/rental/models.py`, `backend/requirements.txt`, and `README.md`. Batch 4A `TermProvenance` now permits confirmed document terms only when `reviewed_by_user=true`; existing unreviewed extracted terms remain rejected.

The declared dependencies are `google-genai==2.33.0`, `python-dotenv>=1.0,<2`, `python-multipart>=0.0.9,<1`, and `pypdf>=5,<7`. The SDK version is pinned from the current official release ([2.33.0 release](https://github.com/googleapis/python-genai/releases/tag/v2.33.0)); the local Python interpreter is unavailable, so the package could not be installed or executed here. The implementation uses the maintained `google-genai` SDK API and defaults to `gemini-3.5-flash-lite`, which current official model documentation describes as stable, cost-conscious, PDF-capable, and supporting structured output ([model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), [structured output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output)). `GEMINI_MODEL` can override the default; model access is not assumed.

## Configuration and API

The ignored root `.env` may contain `GEMINI_API_KEY` and optional `GEMINI_MODEL`. `.env.example` contains only placeholder values. `/api/lease/status` reports `configured`, selected model, and `service_ready`, never the key. Without a key, only Gemini extraction is unavailable; other routes are independent.

- `POST /api/lease/extract-text`: JSON `{ "text": "..." }`, limited to 120,000 characters.
- `POST /api/lease/extract-pdf`: multipart PDF, max 10 MiB and 80 pages.
- `POST /api/lease/confirm`: submits the complete draft and one review decision for each field. Actions are `accept`, `correct`, `mark_unknown`, and `confirm_none`; optional financial profile invokes `evaluate_rental` only after the offer is valid.
- `GET /api/lease/status`: safe provider readiness information.

The extraction schema represents typed field IDs, candidate value, excerpt, optional page reference, extraction status (`explicit`, `not_found`, `ambiguous`, `contradictory`), evidence verification, uncertainty note, and review state. Unknown charges are mapped to Batch 4A `unknown`, never silently zero. Required label, base rent, and term must be explicitly accepted or manually corrected. Corrections preserve the model candidate in response review history. The draft identifier is a content digest to detect accidental stale/mismatched submissions; it is not an authentication token or tamper-proof signature.

## Document and evidence handling

Pasted text is limited before provider submission. Whitespace and punctuation are normalized for excerpt matching; matching excerpts are marked `verified_text`, and mismatches are explicitly `unverified`. PDF uploads are read in bounded chunks, checked for media type, extension, signature, parseability, encryption, size, and page count. The original PDF bytes are sent inline to Gemini (not the Files API), so no Google Files API object or cleanup step is created. `pypdf` extracts page text only for independent excerpt/page verification; the PDF itself is still sent for native layout/vision interpretation. A page number is marked verified only if the excerpt matches exactly one locally parsed page; otherwise the page remains model-suggested/unverified.

The extraction prompt is fixed server-side and says the document is untrusted evidence, not instructions. No links, scripts, commands, or external URLs are fetched. There are no document logs or application storage writes. Starlette may spool multipart request bodies to its temporary upload storage before the route reads them; this is transient framework handling rather than application persistence. The client receives excerpts, not the submitted full source document.

Gemini receives lease content. This implementation does not claim that content is private from Google. Google's terms distinguish data handling between paid and unpaid use; paid services state prompts/responses are not used to improve products, while abuse monitoring can still retain prompt/response data for a limited period. Review the applicable terms for the configured project before using personal leases ([Google data-retention documentation](https://ai.google.dev/gemini-api/docs/zdr), [API terms](https://ai.google.dev/gemini-api/terms)). Use synthetic documents for demonstrations.

## Errors and safety

Invalid input returns 422, unsupported media 415, excessive PDF size 413, missing configuration/dependencies 503, quota 429, timeout 504, and malformed provider output or other provider errors a sanitized 502. Raw provider exception messages are not returned. There is one bounded provider request per submission, 30-second HTTP timeout, no retry, and a 6,000-token output cap. A process-local guard allows at most five extraction submissions per minute per client address and caps tracked addresses. This is not authentication or a distributed quota; do not expose this local-demo endpoint publicly without additional safeguards.

## Tests and verification

Added tests cover text and PDF evidence matching, multipart PDF bytes and media rejection, invalid amounts and durations, unknown fields, duplicate field IDs, evidence requirements, exact-draft confirmation, corrections and manual entry, unknown versus explicit no-charge, provenance, optional financial evaluation, provider quota/timeout/error sanitization, no-key status and response behavior, text limits, prompt-injection instructions, and the process-local request limit. The pre-change Batch 4A baseline was 115 passed, as recorded in Batch 4A.

**Tests were not executable in this environment.** `.venv\Scripts\python.exe` resolves to a missing `C:\Users\ykkad\AppData\Local\Programs\Python\Python312\python.exe`; `py -0p` reports no installed Python runtimes. Therefore the Batch 4B tests, complete backend suite, and live TestClient/API checks have not been run, and no passing result is claimed. The key-presence check found no `GEMINI_API_KEY` in `.env`, so no live Gemini request was made. The local `.env` remains Git-ignored; no credentials or lease documents were written to tracked files.

## Remaining work and Batch 5 readiness

Before use, install the declared backend dependencies in a working Python environment, run the full pytest suite and TestClient endpoint checks, review any failures, and configure a Gemini key locally if a single synthetic live smoke test is desired. No manual key or billing changes were made. Batch 5A can call the deterministic financial evaluator only with a confirmed offer; Batch 5B can build a review interface against these endpoints. Extraction quality is probabilistic and evidence matching is literal after normalization; neither extraction nor a citation establishes legal meaning or enforceability.
