# Batch 5B.1: live Gemini extraction repair

## Root cause

The root `.env` was loaded from the repository root. The secret-presence check reported configured without printing the key; the selected model was `gemini-3.5-flash-lite`. The installed SDK was `google-genai==2.33.0`, and its `models.generate_content`, `GenerateContentConfig.response_json_schema`, and `HttpOptions.timeout` interfaces are present.

Minimal connectivity to the configured model succeeded, and a small structured-output request succeeded. This confirmed that the key authenticated and the account could use the selected model. The failure was in the NestWise response schema path.

NestWise had passed the full Pydantic `LeaseExtraction` model as `response_schema`. In the installed SDK, this goes through the Pydantic-to-`types.Schema` transformer. That transformer rejects typed `additionalProperties` for Gemini Developer API clients and raises a local `ValueError` before making the model call; the API route sanitized it to HTTP 502. Passing Pydantic's full generated schema through `response_json_schema` reached Gemini, but the selected model rejected that full schema with HTTP 400. A compact schema with an unconstrained `value` field was accepted, but a later local validation check correctly rejected some generated values. The final schema keeps the lease-value shape constrained while avoiding the unsupported and overly complex parts of Pydantic's generated schema.

## Changes

`backend/app/lease_extraction/provider.py` now builds a compact JSON Schema for the extraction envelope and sends it through `response_json_schema`. The schema enumerates supported field IDs, extraction statuses, evidence states, and review state. Candidate values are restricted to the scalar, object, and array shapes accepted by the existing `CandidateTerm` model. The model output still passes through `LeaseExtraction.model_validate()` before any evidence verification or draft creation, so amount checks, allowed object shapes, unique field IDs, and all existing human-review requirements remain enforced.

The provider keeps the 30-second timeout and request limit. With `NESTWISE_GEMINI_DIAGNOSTICS=1`, server logs can report the failing stage, safe category, exception class, HTTP code, and (when supplied) a schema field path or Pydantic field ID. They do not log exception messages, API keys, submitted text, or provider response values. HTTP responses remain sanitized. The environment variable is opt-in and local; it does not change client responses.

Added regression coverage confirms the compatible raw schema is used, Pydantic validation remains in the path, and development diagnostics do not include synthetic lease text or a test key. Existing quota, timeout, and sanitized error handling tests remain unchanged.

## Live verification

The `.env` presence and model checks printed only `configured=true`, the model name, and SDK version; the API key itself was never printed. The actual model passed a minimal connectivity prompt and a small JSON structured-output prompt. Both responses were checked for presence or valid schema shape without printing generated content.

Using only synthetic lease text, the corrected `POST /api/lease/extract-text` returned HTTP 200 with a valid draft. The full flow then returned HTTP 200 from `POST /api/lease/confirm` after every draft term received a review decision, followed by HTTP 200 from `POST /api/rental/evaluate`. For this demonstration, the three required fields were corrected to the known synthetic values, the prepaid-rent yes/no terms were explicitly reviewed, and other unreviewed optional fields were marked unknown. No personal lease or financial profile was submitted.

The API request completed within the configured 30-second provider timeout. The timeout was not increased. No billing or Google Cloud settings were changed, and no dependencies were installed.

## Test results

Final checks on 2026-10-24:

| Check | Result |
|---|---|
| `tests/test_lease_extraction.py` | **22 passed**, one existing Starlette/TestClient deprecation warning |
| Full backend suite: `.venv\Scripts\python.exe -m pytest -q` | **168 passed**, one existing Starlette/TestClient deprecation warning |
| Frontend: `npm test` | **36 passed** across 5 files |
| Frontend: `npm run typecheck` | Passed |
| Frontend: `npm run build` | Passed; Vite 6.4.5 production bundle |

The earlier `response_json_schema` request using the full generated Pydantic schema returned a sanitized 400 from Gemini. The exact provider message was intentionally not logged or returned, so the individual unsupported/complex schema keyword was not isolated. The working compact schema and successful endpoint, review, and evaluation flow verify the repair. Pydantic remains the final output validator; malformed model output still returns a sanitized 502.

## Manual steps and limits

No manual action is required for the tested local configuration. Genuine lease uploads still transmit document content through the backend to Google Gemini when extraction is available; use synthetic documents for demonstrations and review applicable Google service terms before submitting a personal lease. Provider extraction remains probabilistic and every candidate still requires a user decision. Do not enable provider diagnostics in a shared or public server unless its logs are appropriately protected.

The implementation remains a local development feature. No commit, push, deployment, or Batch 6 work was performed.
