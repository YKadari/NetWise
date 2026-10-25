# Batch 8: PDF extraction and lease review

## PDF diagnosis and change

The previous failure was reported as an extraction timeout for an approximately 0.03 MB synthetic PDF. That particular document and its diagnostic log were unavailable, so its precise cause remains unverified. The code path maps SDK transport timeouts and provider HTTP 408/504 to the app's 504 response. Invalid MIME/signature, malformed or encrypted files, and more than 80 pages fail before Gemini; invalid structured responses fail as 502. The frontend has no independent extraction timer. The Gemini client still uses `gemini-3.5-flash-lite`, a 30-second request timeout, inline original PDF bytes, and the existing structured-output schema.

One live request was made **before the worker-pool change** with a different, generated, one-page **835-byte text PDF**. It returned HTTP 200 and a valid review draft in **8.0 seconds**. Safe provider diagnostics measured 7.2 seconds in `gemini_api_call`; rent and duration matched the synthetic source and four excerpts verified against its PDF page. This establishes that the local PDF route and model can succeed. It does not prove that the previously failing PDF now succeeds or explain its timeout. No further live request was made.

The PDF route previously ran the synchronous Gemini SDK call inside an asynchronous route on the ASGI event loop. It now places PDF parsing, the SDK call, and evidence verification in Starlette's worker pool. The text route was already synchronous and used FastAPI's worker pool. A concurrent-request test verifies that `/api/lease/status` responds while a PDF provider call waits. This change prevents one slow PDF request from blocking unrelated requests; it does not alter or claim to cure the provider timeout. No model or timeout value changed.

The route still checks file extension and `application/pdf` MIME, reads in bounded chunks up to 10 MiB, checks the PDF signature, uses strict PDF parsing, rejects encrypted and malformed files, and limits documents to 80 pages. Original bytes are submitted inline without a Files API upload. Evidence matching and the human confirmation API remain intact. Exceptions return sanitized categories and never include lease text, credentials, or raw provider responses.

## Review experience

The first view presents rent, lease length, named monthly fees, utility estimates, deposit, identified move-in charges, and first/last month's prepaid rent. It avoids an upfront total while charge lists may be incomplete. Deposit refund conditions are explicitly unconfirmed because the extraction schema has no separate refund-terms field; deposits remain separate from expenses in the evaluator. Estimated utilities are labeled as estimates. Optional charges and charges without clear refund treatment require correction before inclusion.

“Questions worth asking” prioritizes complete monthly and move-in fee schedules, deposit/refund terms, and early-departure obligations. Other payments, discounts, and lease conditions are collapsed. Source excerpts and page-verification labels open on demand through keyboard-accessible disclosures. Named fees use individual name/amount controls instead of a pipe-delimited list. Unclear and contradictory candidates remain flagged.

The final checkbox confirms the displayed core details. Hidden discounts, holding deposits, fee-list completeness, and legal clauses remain unknown unless the renter takes a separate action. Every draft term still receives one review decision, and the backend confirmation contract and deterministic financial formulas are unchanged. The UI offers pasted-text and manual-entry actions when extraction fails; it does not fabricate terms.

## Verification on 2026-10-25

| Check | Actual result |
|---|---|
| Full backend pytest | **184 passed**, one existing Starlette/TestClient deprecation warning |
| Frontend tests | **76 passed** across 7 files |
| Frontend TypeScript typecheck | Passed |
| Frontend production build | Passed; Vite 6.4.5 |
| `git diff --check` | Passed; Git printed line-ending notices only |
| Live synthetic PDF endpoint | HTTP 200, valid draft, matching rent/duration, 4 page-verified excerpts |

Backend tests mock Gemini and cover valid text PDFs, original-byte submission, page evidence, upload rejection, sanitized timeout/quota/provider errors, SDK MIME/schema construction, and event-loop responsiveness. Frontend tests cover named fees, missing information, source disclosure, editing, hidden-term decisions, explicit confirmation, PDF multipart submission, and fallback actions. The single live request used a different synthetic PDF before the route change; the user's original 0.03 MB PDF, post-change live provider behavior, and mobile browser rendering were not reproduced in this run. Docker was not built. No personal lease was submitted to Gemini.

## Local reproduction

Start the local backend and frontend using the commands in [Batch 7D](BATCH_7D_GEMINI_ROLLBACK.md). Keep the local Gemini key only in the ignored root `.env`. To collect safe timings for the **specific** PDF that timed out, restart the backend in PowerShell with:

```powershell
$env:NESTWISE_GEMINI_DIAGNOSTICS = '1'
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8001 --reload
```

Upload one synthetic PDF. The server log records stage, category, HTTP code, and milliseconds without logging the document or key. A timeout around 30,000 ms at `gemini_api_call` indicates the SDK/provider request stage; a rejection at `request_construction`, `response_parsing`, or `pydantic_validation` needs a different fix. For a one-request known-good text-PDF diagnostic without showing its contents or key, run `.\.venv\Scripts\python.exe -m scripts.diagnose_pdf_extraction --live` from the repository root. Do not repeatedly submit the file if the provider is quota-limited.

From the repository root run `.\.venv\Scripts\python.exe -m pytest -q`. From `frontend/` run `npm test`, `npm run typecheck`, and `npm run build`. Public Gemini extraction remains disabled in `render.yaml`. No Render setting, cloud service, commit, push, or deployment was changed.
