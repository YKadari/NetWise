# Batch 3B: sensitivity and area comparison

## Scope

Batch 3B extends the Batch 3A React explorer with live budget sensitivity, two area comparison, responsive navigation, clearer recommendation and detail hierarchy, and Chicago pilot onboarding. It reuses the existing FastAPI endpoints and keeps the API as the source of truth for eligibility, Pareto membership, ordering, sensitivity, and area differences. No housing data, backend calculations, Gemini integration, paid service, or deployment setup changed.

Baseline before Batch 3B: **12 frontend tests passed** and **77 backend tests passed** with one existing Starlette/TestClient deprecation warning.

## User experience

The desktop layout keeps preferences, a large map, and recommendations in a three column arrangement at 1280px and wider. At 1024px, preferences and map are side by side, with the shortlist below. At 768px and 390px, controls are available through a Filters button and clear Map/Results tabs. Results view includes both the shortlist and sensitivity panel; selecting an area returns to the map view and opens its details. The map remains prominent and offers a Full Chicago view button. Responsive widths were inspected in Chrome, and a DOM width check found no horizontal overflow at 1440, 1024, 768, or 390 pixels.

Cards now give more room to ZIP, bedroom-specific HUD rent, budget difference, Loop and CTA proximity, and a short backend explanation. “Efficient tradeoff” appears in the interface with an expandable explanation of Pareto efficiency. Details sit beneath the map, leaving the recommendation column available. Compared areas have a dashed outline and selected areas retain the amber highlight. The two-area comparison appears in a closable dialog with neutral factual differences and directions links. A header information panel explains HUD payment benchmarks, ZCTAs, straight-line distances, the Loop assumption, and the Chicago pilot scope.

## API integrations

`frontend/src/lib/api.ts` adds typed calls for `POST /api/sensitivity` and `POST /api/areas/compare` with request validation and response-shape checks. A cancellable effect requests sensitivity whenever the applied preferences change, including bedroom and distance hard limits. The panel charts the exact budget reruns returned by the backend; it does not interpolate between them. It displays the current number of qualifying areas, nearby counts and deltas, newly qualifying ZIPs, and the exact next budget threshold. Its Apply button submits the backend-provided threshold through the existing optimization endpoint. Soft budgets show unchanged eligibility counts and the backend explanation, with no next-unlock action. A null unlock is shown as the backend explanation, without inventing a threshold.

Comparison can be started from either a recommendation card or selected-area details. The main interface keeps exactly two ZIPs; adding a third replaces the oldest selection with a notice, and selected ZIPs can be removed. The dialog shows selected and all five HUD benchmarks, current budget fit, Loop distance, nearest CTA station and distance, stations within 2 km, current Pareto status, directions URLs, and the API pairwise differences. It describes measured differences without declaring a universally better area.

## Files changed

Added `frontend/src/components/SensitivityPanel.tsx`, `frontend/src/components/ComparisonDialog.tsx`, `frontend/src/test/batch3b.test.tsx`, and this report. Updated `frontend/src/App.tsx`, `src/lib/api.ts`, `src/lib/preferences.ts`, `src/types/api.ts`, `src/components/Header.tsx`, `src/components/HousingMap.tsx`, `src/components/RecommendationsPanel.tsx`, `src/components/AreaDetails.tsx`, `src/styles.css`, and `src/test/ui.test.tsx`. Updated `README.md` with Batch 3B behavior and a report link. The existing API and optimization implementations were left unchanged.

## Tests

Final checks on 2026-10-24:

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm test` | **20 passed** across 4 files |
| `npm run build` | Pass; Vite 6.4.5 production build |
| `.venv\Scripts\python.exe -m pytest -q` | **77 passed**, one existing Starlette/TestClient warning |

New frontend tests cover sensitivity request construction with changed bedroom and hard limits; exact next-unlock and apply action; soft-budget flat counts; empty/no-unlock, loading, and error states; comparison request validation and construction; adding, removing, and replacing selected areas; and comparison display with rent, station, Pareto, and measured difference fields. Existing tests continue to cover budget/bedroom controls, API failures, empty recommendations, and card selection.

## Real-data verification

The existing local FastAPI and Vite servers were used in Chrome. The default $1,900 one-bedroom profile loaded **38 of 64** qualifying areas and **10** Pareto-efficient areas, with ZIP `60653` first. Live sensitivity returned nearby exact results and no interpolated values.

For a $1,600 hard one-bedroom budget, the backend returned **24** qualifying areas and a next unlock of **$1,620** for ZIP `60638`. Applying the suggestion changed the active budget and displayed **25** qualifying areas. With an 8 km maximum Loop distance at that budget, the backend returned **3** areas and the next unlock at **$1,890** for ZIP `60612`. This confirms sensitivity receives and preserves the applied hard distance limit.

The real `/api/areas/compare` response for ZIP `60601` and ZIP `60608` gave one-bedroom HUD benchmarks of **$2,670** and **$1,530**, respectively, a measured difference of **$1,140**. Their Loop distances were about **0.62 km** and **5.15 km**; nearest CTA distances were about **0.29 km** and **0.70 km**. Their nearby station counts were 22 and 5. Each response supplied an outbound Google Maps URL. In the live comparison dialog, ZIPs `60653` and `60609` rendered their real rent and station data and reported that ZIP 60609 costs $10 less while ZIP 60653 is closer to both measured destinations. Removing an area returned the comparison to one selection and hid the compare action.

Mobile browser verification showed the Results tab with sensitivity and recommendations, and choosing a recommendation returned to Map and loaded the selected area's details. The 1440px, 1024px, 768px, and 390px layouts were inspected. The live browser document width matched the available viewport at each size (document/body widths 1425/1425, 1009/1009, 753/753, and 375/375 px respectively, accounting for browser chrome and scrollbars); no horizontal overflow was present. The live browser console had **no errors**. CTA station visibility, the Loop point, the ZIP selector, directions URLs, map reset control, and comparison selection styling were retained.

Screenshots were inspected in the browser, but screenshot bytes were not available as a local file through the connected browser tool, so no screenshot files were saved in the repository.

## Interactive budget scenario follow-up

The exact budget result cards are now native keyboard-operable buttons. Selecting one highlights it and opens a preview with that monthly budget, the qualifying-area count and delta against the applied budget, plus newly qualifying or no-longer-qualifying ZIPs from the same sensitivity response. The preview does not change preferences until **Apply selected budget** is pressed; this reuses the existing budget form and optimization workflow. The separately labeled **Next exact budget unlock** and its Apply action remain available. The current applied amount is identified on its own card. A preference edit clears the selected preview, and changing the applied profile aborts the prior sensitivity request and hides its data until the new response arrives.

Follow-up verification: frontend **23 tests passed** across 4 files, TypeScript typecheck passed, production build passed, and backend **77 tests passed** with the same existing deprecation warning. Coverage includes card selection/focus, selected-budget preview and explicit apply, both newly qualifying and no-longer-qualifying ZIPs, and hiding old preview content while sensitivity is refreshing. In Chrome, keyboard Enter selected a scenario and opened its preview. Profile freshness treats omitted optional preferences and API-returned nulls as equivalent, matching the existing FastAPI schema.

## Limits and next steps

The sensitivity counts refer to geographic areas that meet HUD benchmark and distance constraints, not available apartments. HUD values remain payment-standard benchmarks. The map still uses approximate 2020 Census ZCTAs and straight-line distances. The Loop remains the only workplace destination. The comparison dialog uses the current profile's Pareto set; it does not claim overall area quality. No preference persistence was added.

Batch 4 can add user-selected commute destinations or route-time support only after a data and routing source is selected, and can add a Gemini explanation layer that remains grounded in the existing API output. The frontend is ready for a Gemini integration behind a separate, reviewed service boundary. No Gemini provider or API key is present in Batch 3B.
