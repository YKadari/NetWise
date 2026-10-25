import { useEffect, useRef, useState } from 'react'
import { compareRentals, explainRentalComparison } from '../lib/rentalApi'
import { money } from '../lib/rentalForms'
import type { FinancialProfile, LeaseServiceStatus, RentalComparison as ComparisonResult, RentalComparisonExplanation, RentalOffer } from '../types/rental'

interface Props { a: RentalOffer | null; b: RentalOffer | null; profile?: FinancialProfile; profileError?: string | null; status?: LeaseServiceStatus | null; onEdit: (slot: 'A' | 'B') => void; onDemo: () => void }

export function RentalComparison({ a, b, profile, profileError, status, onEdit, onDemo }: Props) {
  const [result, setResult] = useState<ComparisonResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aiResult, setAiResult] = useState<RentalComparisonExplanation | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const aiController = useRef<AbortController | null>(null)
  const inputKey = JSON.stringify({ a, b, profile })
  const currentInputKey = useRef(inputKey)
  currentInputKey.current = inputKey
  useEffect(() => { setResult(null); setError(null); setAiResult(null); setAiError(null); aiController.current?.abort() }, [inputKey])
  useEffect(() => () => aiController.current?.abort(), [])
  const run = async () => {
    if (!a || !b || busy || profileError) return
    setBusy(true); setError(null)
    try {
      const comparison = await compareRentals(a, b, profile)
      if (currentInputKey.current === inputKey) setResult(comparison)
    }
    catch (cause) { if (currentInputKey.current === inputKey) setError(cause instanceof Error ? cause.message : 'Comparison unavailable.') }
    finally { setBusy(false) }
  }
  const explain = async () => {
    if (!a || !b || !status?.service_ready || aiBusy) return
    const controller = new AbortController(); aiController.current?.abort(); aiController.current = controller
    setAiBusy(true); setAiError(null); setAiResult(null)
    try { const value = await explainRentalComparison(a, b, profile, controller.signal); if (!controller.signal.aborted && currentInputKey.current === inputKey) setAiResult(value) }
    catch (cause) { if (!controller.signal.aborted && currentInputKey.current === inputKey) setAiError(cause instanceof Error ? cause.message : 'AI comparison explanation is unavailable.') }
    finally { if (!controller.signal.aborted) setAiBusy(false) }
  }
  const comparisonRows: [string, (keyof ComparisonResult['differences']['left_minus_right']), (value: number) => string][] = [
    ['Advertised base rent / month', 'base_rent_per_month', money],
    ['Known gross monthly obligation', 'gross_known_recurring_housing_cost_per_month', money],
    ['Average monthly obligation after concessions', 'average_modeled_monthly_housing_cost_after_concessions', money],
    ['Upfront cash required', 'upfront_cash_required', money],
    ['Refundable cash held', 'refundable_cash_held', money],
    ['Known lease expense', 'known_modeled_nonrefundable_lease_expense', money],
    ['Normalized lease expense / month', 'normalized_known_lease_expense_per_month', money],
    ['Monthly cash remaining after savings target', 'monthly_cash_remaining_after_housing_and_savings', money],
  ]
  return <div className="space-y-5"><div className="flex flex-wrap items-end justify-between gap-4"><div><div className="kicker">Compare</div><h1 className="mt-1 font-display text-3xl">Two offers. One set of assumptions.</h1><p className="mt-2 text-sm text-muted">Compare what each offer requires without assigning a winner.</p></div><button type="button" className="min-h-11 rounded-xl border border-forest px-4 text-sm font-bold text-forest" onClick={onDemo}>Try a synthetic two-offer demo</button></div>
    <div className="grid gap-4 md:grid-cols-2">{([['A', a], ['B', b]] as const).map(([slot, offer]) => <section key={slot} className="surface p-5"><div className="kicker">Rental {slot}</div><h2 className="mt-1 font-display text-2xl">{offer?.rental_label || 'No offer saved yet'}</h2>{offer ? <p className="mt-2 text-sm text-muted">{money(offer.monthly_base_rent)} advertised base rent · {offer.lease_term_months} months</p> : <p className="mt-2 text-sm text-muted">Evaluate an offer in Analyze, then save it here.</p>}<button type="button" className="mt-4 min-h-10 text-sm font-bold text-forest underline" onClick={() => onEdit(slot)}>Enter or change Rental {slot}</button></section>)}</div>
    {profileError && <p role="alert" className="text-sm text-red-800">{profileError}</p>}
    <button type="button" onClick={run} disabled={!a || !b || busy || Boolean(profileError)} className="min-h-11 rounded-xl bg-forest px-6 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Comparing…' : 'Compare the offers'}</button>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error} <button type="button" className="font-bold underline" onClick={run}>Retry</button></p>}
    {result && <section className="surface overflow-hidden" aria-label="Rental comparison results"><div className="bg-ink px-5 py-5 text-white"><h2 className="font-display text-2xl">Measured differences</h2><p className="mt-1 text-sm text-white/75">A minus B. Both evaluations use the same {profile ? 'financial profile' : 'offer-only calculation'}.</p></div><section className="space-y-3 border-b border-line bg-canvas px-5 py-4" aria-label="Understanding the tradeoffs"><h3 className="font-display text-xl">Understanding the tradeoffs</h3><p>{result.interpretation.main_tradeoff}</p><p>{result.interpretation.upfront_comparison}</p><p>{result.interpretation.monthly_and_lease_comparison}</p><p>{result.interpretation.important_uncertainties}</p><p>{result.interpretation.what_could_change_the_decision}</p>{status?.service_ready && <div className="space-y-2 border-t border-line pt-3"><button type="button" disabled={aiBusy} onClick={() => void explain()} className="min-h-10 rounded-xl border border-forest px-4 font-bold text-forest focus-visible:outline focus-visible:outline-4 focus-visible:outline-mint disabled:opacity-50">{aiBusy ? 'Prioritizing comparison…' : 'Explain these tradeoffs with AI'}</button>{aiBusy && <p role="status" className="text-sm text-muted">Selecting grounded comparison statements. No rental decision is being made.</p>}{aiError && <p role="alert" className="text-sm text-coral">{aiError} Deterministic measurements remain available.</p>}{aiResult && <div role="status" aria-label="AI-prioritized comparison explanation" className="space-y-2 rounded-xl border border-line bg-white p-4"><h4 className="font-semibold">AI-prioritized explanation</h4><p>{aiResult.main_tradeoff}</p><p>{aiResult.upfront_comparison}</p><p>{aiResult.monthly_and_lease_comparison}</p><p>{aiResult.important_uncertainties}</p><p>{aiResult.what_could_change_the_decision}</p></div>}</div>}</section>{result.differences.lease_terms_differ && <p className="border-b border-line bg-amber-50 px-5 py-3 text-sm text-amber-950">Lease lengths differ. Full-term totals span different periods; use the normalized monthly value for a like-for-like view.</p>}<div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead><tr className="border-b border-line bg-canvas"><th className="px-5 py-3">Measure</th><th className="px-5 py-3">Rental A</th><th className="px-5 py-3">Rental B</th><th className="px-5 py-3">A minus B</th></tr></thead><tbody>{comparisonRows.map(([label, key, format]) => {
      const diff = result.differences.left_minus_right[key]
      const left = key === 'base_rent_per_month' ? result.left.monthly_costs.base_rent_before_concessions : key === 'gross_known_recurring_housing_cost_per_month' ? result.left.monthly_costs.gross_known_monthly_housing_obligation : key === 'average_modeled_monthly_housing_cost_after_concessions' ? result.left.monthly_costs.average_modeled_housing_obligation : key === 'upfront_cash_required' ? result.left.upfront.upfront_cash_required : key === 'refundable_cash_held' ? result.left.upfront.refundable_cash_held : key === 'known_modeled_nonrefundable_lease_expense' ? result.left.lease_totals.known_modeled_nonrefundable_lease_cost : key === 'monthly_cash_remaining_after_housing_and_savings' ? result.left.financial_profile?.known_monthly_cash_remaining_after_housing_and_savings : result.left.lease_totals.known_modeled_nonrefundable_lease_cost / result.left.lease.term_months
      const right = key === 'base_rent_per_month' ? result.right.monthly_costs.base_rent_before_concessions : key === 'gross_known_recurring_housing_cost_per_month' ? result.right.monthly_costs.gross_known_monthly_housing_obligation : key === 'average_modeled_monthly_housing_cost_after_concessions' ? result.right.monthly_costs.average_modeled_housing_obligation : key === 'upfront_cash_required' ? result.right.upfront.upfront_cash_required : key === 'refundable_cash_held' ? result.right.upfront.refundable_cash_held : key === 'known_modeled_nonrefundable_lease_expense' ? result.right.lease_totals.known_modeled_nonrefundable_lease_cost : key === 'monthly_cash_remaining_after_housing_and_savings' ? result.right.financial_profile?.known_monthly_cash_remaining_after_housing_and_savings : result.right.lease_totals.known_modeled_nonrefundable_lease_cost / result.right.lease.term_months
      return <tr key={label} className="border-b border-line/70"><th scope="row" className="px-5 py-3 font-semibold">{label}</th><td className="px-5 py-3">{format(left ?? NaN)}</td><td className="px-5 py-3">{format(right ?? NaN)}</td><td className="px-5 py-3">{diff === null ? 'Unknown' : `${diff >= 0 ? '+' : '−'}${format(Math.abs(diff))}`}</td></tr>
    })}</tbody></table></div><div className="space-y-2 px-5 py-4 text-sm text-muted">{result.comparison_notes.map((note, index) => <p key={index}>{note}</p>)}{(result.differences.unknown_cost_categories.left.length > 0 || result.differences.unknown_cost_categories.right.length > 0) && <p className="text-coral">Unknown costs remain: A — {result.differences.unknown_cost_categories.left.join(', ') || 'none reported'}; B — {result.differences.unknown_cost_categories.right.join(', ') || 'none reported'}. Listed values are known subtotals.</p>}</div></section>}
  </div>
}
