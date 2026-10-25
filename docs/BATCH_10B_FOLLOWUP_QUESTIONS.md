# Batch 10B: grounded follow-ups and landlord questions

## Renter workflow

After the existing evaluator results and Rental Decision Brief, the renter sees one **Before you sign** section. It explains each selected issue in plain language, gives a corresponding copyable landlord question, and optionally shows the underlying evaluator fact. Up to three items appear first. Further grounded candidates are available under **See all questions**. When no eligible concern is represented by the validated terms, the section says so without adding speculative risks. The prior guided-flow question list was removed from the results screen, leaving one source of questions.

**Suggested questions** are ranked by deterministic server rules and work when Gemini is disabled or unavailable. After the renter explicitly requests **Generate AI insights**, the existing single Gemini request selects and orders the top candidates alongside the existing decision-brief statements. The UI then labels the selected list **AI-prioritized questions**; questions not selected remain under the disclosure. If AI fails, deterministic suggestions remain visible. Changes to the offer/evaluation or stale profile abort old requests and hide results tied to the previous inputs.

The UI provides **Copy question** and **Copy all questions**, with live status announcements. Copying only transfers question text to the clipboard; it does not send email or include personal profile values.

## Candidate catalog and grounding

Candidates are built from validated `RentalOffer` fields and a fresh server-side `evaluate_rental` result. They are static server-owned templates; user-supplied rental labels, fee names/descriptions, lease text, income, savings amounts, and contact information are not included in candidate text or sent to Gemini.

| Candidate | Eligibility condition | Example question basis |
|---|---|---|
| Required monthly fees | `recurring_charges` is in evaluator unknown categories | Written schedule beyond the verified advertised rent; fee types are examples to check, not claims that they exist |
| Utilities | Utility category is unknown or offer explicitly marks utilities estimated | Which utilities are included and typical unit costs |
| Move-in payments | Evaluator marks a first/last rent timing, fee list, other charge list, holding deposit, or credit target unknown | Itemized amounts, due dates, credits, refund treatment |
| Security deposit | Deposit amount/treatment unknown, or an amount is provided | Ask whether required and how treated; when known, use the actual server-validated amount when asking about return terms |
| Holding deposit | Status is unknown | Whether required, amount, and credit/refund treatment |
| Roommate amount | A financial profile includes a roommate contribution while the offer has no confirmed contribution | Ask what each roommate can commit to |
| Shared rent responsibility | The validated offer or profile includes a roommate contribution | Ask whether tenants remain responsible if one roommate stops paying; phrased as a question, not a claim about this agreement |
| Cash reserve | Evaluator says the supplied emergency reserve is not preserved after known move-in cash | Reconfirm the complete itemized move-in amount; no savings/income amount is disclosed |

Explicitly absent terms (`none`, `included`, or complete lists with no charges) do not create missing-term questions. A specific early-termination obligation, concession uncertainty, optional parking preference, or insurance requirement is not present in the evaluator request/model contract, so this feature does not infer or ask as if one were found. Lease clauses are not passed into this endpoint. The candidate catalog is therefore intentionally limited to the current validated structured data.

The deterministic order places potentially recurring cost uncertainty first, then move-in cash and deposit treatment, then roommate assumptions and derived reserve concerns. The label on a card describes its subject (for example, “Ongoing cost” or “Before move-in”), not a probability or legal/financial severity score. Gemini can rank only the server-generated candidate IDs and cannot generate prose, amounts, new risks, or landlord practices. It must select exactly `min(3, eligible candidate count)` unique IDs; the server checks membership and renders all displayed questions and amounts from its templates.

## API changes

- `POST /api/rental/follow-ups` accepts the existing strict `{offer, financial_profile?}` request. The server recomputes the evaluator and returns `source: "deterministic"`, up to three `follow_ups`, and `additional_follow_ups`. This route performs no AI call and does not depend on the Gemini flag or rate limiter.
- `POST /api/rental/decision-brief` keeps its existing request and adds `follow_ups` and `additional_follow_ups` to its response. In the same structured Gemini request, `follow_up_ids` is selected alongside the existing statement IDs. A change to that response is additive; the financial evaluator and formulas are unchanged.

Both routes reject extra request fields, including client-supplied totals, and recompute from validated terms. The deterministic endpoint exposes no AI capability and does not bypass the existing production gate: Gemini remains behind `extraction_enabled()` and its shared process-local request limiter. Public Gemini remains disabled in `render.yaml`.

## Example

With the existing synthetic $1,600/month sample, an incomplete required monthly fee list can produce:

- **Confirm required monthly fees** — “The complete required-fee schedule is not confirmed, so the monthly subtotal may change.”
- **Ask:** “Could you provide a written list of every required monthly charge beyond the $1,600 advertised rent, including any building, internet, trash, or service fees?”

The examples are requests for confirmation, not assertions that the rental has those charges. If the renter confirms no required monthly fees and no other modeled uncertainty, the monthly-fee question disappears after recalculation.

## Privacy, cost, and fallback

The deterministic route receives only the offer and optional profile needed for the evaluator, recalculates server-side, and returns static candidate templates. It does not call Gemini or store data. Its output includes personal context only through the approved question and a small status label; raw income, savings and profile amounts are not copied or sent to the model.

The existing AI insight action remains explicit and uses one bounded Gemini call, existing model configuration, feature gate, timeout, and rate guard. Gemini receives evaluator-derived non-identifying facts and allowed IDs, not the user label, named fees, descriptions, profile amounts, or question text. Model output is strictly validated before rendering. The local process limiter is not a distributed quota or hard spend cap. No provider call was needed to build or test this feature.

## Verification status

Verification on 2026-10-25:

| Check | Result |
|---|---|
| Frontend TypeScript typecheck | Passed |
| Frontend test suite | **97 passed** across 9 files |
| Frontend production build | Passed; Vite 6.4.5, with the existing advisory for a 504 kB minified JS chunk |
| `git diff --check` | Passed; Git printed line-ending conversion notices only |
| Focused/full backend pytest | Not run: `py -0p` reports no installed Python runtimes and `.venv\Scripts\python.exe` is absent |
| Live Gemini | Not run; this batch used mocked provider tests only and consumes no provider quota |

The frontend suite covers copy actions and screen-reader status, keyboard focus, selected versus extra questions, fewer than three eligible questions, deterministic fallback on AI failure, stale response invalidation, and the single consolidated section. Backend tests were added for catalog eligibility and exclusions, explicit-none handling, deposits, roommate and reserve signals, ID validation, dynamic structured schema, server-rendered values, privacy, fallback with Gemini disabled, production gate, quota handling and provider failures. Those backend assertions require execution in a working Python environment before release.

After a working Python runtime is available, from the repository root run:

```powershell
python -m pytest -q tests/test_decision_brief.py
python -m pytest -q
```

From `frontend/`, run:

```powershell
npm run typecheck
npm test -- --reporter=dot
npm run build
```

Then inspect one synthetic guided offer with Gemini disabled, verify the deterministic questions change after editing/recalculating, and verify the existing comparison and stress panels remain reachable. A single synthetic AI request can validate AI ordering when local Gemini is configured; it is optional and consumes provider quota. No live Gemini request or fresh browser visual review was performed.

## Hackathon criteria and limitations

- **Technical innovation and AI architecture:** combines deterministic financial recomputation with a constrained model selection over server-owned statement and follow-up IDs, and renders all final content from approved templates.
- **Responsible AI and safety:** no arbitrary model-written advice or invented amount reaches the renter; missing categories remain distinct from confirmed absence; the person asks and decides.
- **Privacy and data ethics:** provider context omits names, labels, addresses, raw lease contents, and income/savings amounts. The evaluator's derived reserve/affordability states can still reveal limited financial context, so they are used sparingly and remain server-side except for the specific resulting question when applicable.
- **Feasibility and sustainability:** deterministic questions work without provider access and reuse current API/evaluator infrastructure; Gemini selection is an explicit single request under the existing gate and process guard.
- **Real-world housing impact:** gives renters concrete prompts to clarify recurring and move-in terms. No stakeholder validation, behavioral outcome, or impact metric is claimed.

Known limits: questions cover only structured fields currently accepted by the rental evaluator; legal clauses and unmodeled fees are not inferred. “Typical monthly costs” are requested from a landlord rather than predicted. The backend suite remains unverified until Python is available. No live provider verification or fresh browser visual review was performed for this batch. No dependency, backend financial formula, housing data, deployment, commit, or cloud setting changed.
