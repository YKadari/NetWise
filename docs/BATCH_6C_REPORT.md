# Batch 6C: simpler AI lease review

## Previous problem and new workflow

The review screen exposed each extraction field as a separate card with a review dropdown, creating a long technical checklist. Batch 6C changes the default path to **Upload or paste → Review a summary → Correct details if needed → Confirm → See rental costs**.

The screen now groups information into four familiar sections: essential rental details, move-in costs, monthly costs, and things worth checking. Name, rent, and lease duration are immediately visible and editable. Missing rent or duration must be entered before the primary action is enabled. A missing rental name defaults to the personal label “My rental,” which the renter can change.

Move-in charges distinguish deposits, prepaid first/last rent, nonrefundable fees, and other charges. The review screen deliberately does not calculate an upfront total; Batch 4A remains authoritative for move-in cash and lease calculations. Monthly charges are readable line items. Unknown utilities, fee lists, and other costs stay marked “Not confirmed,” not `$0`.

Terms that were not found, are ambiguous, or are contradictory are described as unconfirmed. Optional unknowns do not block the renter. Legal clauses are never accepted by the summary checkbox: the renter must explicitly inspect and accept one, enter a correction, mark it unknown, or intentionally confirm that a no-fee condition does not apply. Source excerpts, page references, and verification language are inside “Where did this come from?” disclosures.

## Confirmation adapter and safeguards

`frontend/src/lib/leaseReview.ts` is the pure adapter from the concise review state to the existing `ReviewDecision[]` contract. It preserves the original extraction draft and emits one unique decision for every draft term. Required terms missing from the draft receive explicit correction decisions once supplied; no other absent fields are invented. The renter must check the visible summary before submission, and edits to core or cost values clear that checkbox.

- Unchanged, explicit facts displayed in the financial summary may receive `accept` after the summary is intentionally checked, provided their candidate shape is compatible with the existing confirmation adapter. Unsupported shapes stay unknown unless corrected.
- Changed or manually supplied name, rent, duration, utilities, and charge lists receive `correct` decisions.
- Unseen or missing optional terms default to `mark_unknown`; “not found” never maps to `confirm_none`.
- `confirm_none` is generated only after a corresponding direct action. Confirming that a fee list is complete is separate from confirming that the list contains no fees.
- Legal clause fields default to unknown and are not accepted in bulk. An explicit “I checked this clause” action is needed to accept an extracted clause.
- Potential duplicate utility classification in monthly fees is flagged. Confirmation is blocked until the renter confirms the costs are separate, removes the duplicate from the corrected fee list, or leaves that fee list unconfirmed.
- The editor supports readable line-based charge corrections, utility estimates or “included in rent,” upfront payment yes/no decisions, holding-deposit treatment, and text/amount corrections for clauses. It does not render raw JSON or provenance enums.
- Evidence wording distinguishes text/page matches from an AI-suggested excerpt. Missing excerpts and page references are not fabricated.

The existing `POST /api/lease/confirm` request remains `{draft, decisions}`. The backend still checks the original draft digest, uniqueness, completeness, required terms, evidence, and value schemas. The confirmed offer is then passed through the existing Batch 4A evaluation route. No backend code, financial formulas, housing optimization, Gemini model, saved Rental A/B offers, or manual-entry behavior changed.

## Files added and changed

Added:

- `frontend/src/components/LeaseEvidenceDisclosure.tsx`
- `frontend/src/lib/leaseReview.ts`
- `frontend/src/test/leaseReview.test.ts`
- `docs/BATCH_6C_REPORT.md`

Changed:

- `frontend/src/components/LeaseReview.tsx`
- `frontend/src/components/RentalWorkspace.tsx`
- `frontend/src/test/batch5b.test.tsx`
- `README.md` (clarifies backend decision requirements and links to this workflow report)

No package/dependency, backend, data, optimizer, financial engine, saved-offer comparison, or other product-screen changes were made.

## Verification

Before implementation, the existing frontend baseline passed: `npm run typecheck`, **54 tests across 5 files**, and `npm run build` (Vite 6.4.5).

Final checks run from `frontend/` on 2026-10-25:

| Check | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm test -- --reporter=dot` | **69 passed** across 6 files |
| `npm run build` | Passed; Vite 6.4.5 production bundle |
| `git diff --check` | Passed; only Git line-ending conversion notices |
| `.venv\Scripts\python.exe -m pytest -q` | Could not start; launcher targets missing `C:\Users\ykkad\AppData\Local\Programs\Python\Python312\python.exe` |

New tests cover summary sections and values, missing required rent/duration, manual naming, global confirmation, full decision generation, automatic unknown handling, direct no-charge actions, hidden clause defaults, user corrections, complex Gemini fee shapes, utility duplicate blocking, draft immutability, evidence language, move-in refundable distinctions, and the mocked confirm-to-financial-evaluation path. Existing manual entry, Explore, Compare, and stress tests remain in the passing suite.

No test result is claimed for the Python backend: it was not executable in this environment. The backend contract was inspected directly in `backend/app/api/lease_routes.py`, `backend/app/lease_extraction/models.py`, and `backend/app/lease_extraction/workflow.py`; backend files were not changed.

## Browser QA and limitations

The connected computer-use inventory returned no available browser tabs, and attempts to open a browser reported that neither Chrome visibility nor the in-app browser capability was available. Therefore no live or screenshot-based Batch 6C screen inspection was completed. In particular, desktop/laptop/mobile dimensions, long fee-list layout, actual document extraction, and live extracted-draft confirmation were not browser-verified. Automated tests cover mocked summaries, corrections, evidence disclosure, and the confirm/evaluate sequence. No Gemini request was made, so this pass consumed no provider quota.

Run the application locally after restoring Python 3.12 to verify the actual extraction endpoint and inspect the review at desktop, laptop, and mobile widths. Use only the existing synthetic lease text for live provider checks. The local PowerShell backend test command is:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

The existing pre-deployment limits remain: production needs a same-origin `/api` reverse proxy or equivalent, and the lease extraction route's process-local request guard is not a substitute for shared abuse protection or authentication on a publicly exposed service. Review Google Gemini terms before submitting personal lease documents. These deployment and privacy decisions require owner review; no external service, account, credential, billing, or hosting change was made.

No commit, push, deployment, or later batch work was performed.
