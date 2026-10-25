# Batch 10D: focused AI lease-clause explainer

## Outcome

The Guided Rental Advisor now includes an optional, collapsed **Need help understanding a lease clause?** tool beside the move-in and monthly term questions. A renter pastes one short excerpt and explicitly requests an explanation. The helper presents a cautious plain-language paraphrase, possible qualitative implications, unresolved points, questions to ask, and a verified excerpt. It does not change guided answers, recalculate the offer, or confirm lease terms.

The existing guided flow and text/PDF extraction remain separate. Clause text is sent only to the backend endpoint and then Gemini when the existing local extraction gate is enabled. The endpoint is not called automatically. The backend does not persist or log the excerpt. The service uses the existing Gemini model, timeout, safe provider mapping, production gate, and shared process-local request limiter. Production Gemini remains disabled by the existing Render setting.

## API and safety

`POST /api/lease/explain-clause` accepts only `{ "clause_text": "...", "context": "move_in_payment" }`; the optional context is restricted to a fixed enum and extra fields are rejected. The request is limited to 12–10,000 characters and must contain meaningful text. No offer, profile, client total, or extracted lease draft is accepted.

The provider uses a strict JSON schema. The prompt treats the excerpt as untrusted data and asks for a cautious explanation without legal conclusions, unsupported terms, instructions, or generated numerical claims. The backend validates every response field and rejects generated amounts/dates/percentages, unverified source excerpts, malformed output, and extra fields. A non-clause or insufficient excerpt gets a fixed safe response. The result includes an informational legal limitation; it is not a determination of rights or enforceability. Errors are sanitized and do not echo the source text, provider response, key, or raw exception.

When AI is unavailable, the helper gives a manual fallback: keep the answer unsure, check referenced sections, and ask for clarification in writing. The renter can continue the guided calculation unchanged.

## Verification

Frontend verification during this implementation:

| Check | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm test -- --reporter=dot` | Passed, **101 tests across 9 files** |
| `npm run build` | Passed; Vite 6.4.5, existing advisory for a 514.90 kB minified JS chunk |
| Backend pytest | Not run: `python` is not on PATH; see combined report for the exact environment limitation |
| Live Gemini | Not run; the clause tests mock the provider and no provider quota was consumed |

Frontend tests verify the collapsed helper path, explicit submission, response display, request body minimization, no evaluator call, and safe AI-disabled fallback. Backend tests were added for exact evidence matching, numeric-claim rejection, sanitized provider errors, feature gating, and response safety; they still require execution in a working Python environment.

## Files

New: `backend/app/ai_explanations/clause_explainer.py`, `backend/app/api/clause_routes.py`, `tests/test_clause_explainer.py`, and this report. Updated: `backend/app/ai_explanations/provider.py`, `backend/app/main.py`, `frontend/src/components/GuidedAdvisor.tsx`, `frontend/src/lib/rentalApi.ts`, `frontend/src/types/rental.ts`, and `frontend/src/test/batch9.test.tsx`.

No financial calculation, extraction confirmation, Gemini model, public production gate, or housing functionality changed. No live model call, deployment, commit, or push was performed.
