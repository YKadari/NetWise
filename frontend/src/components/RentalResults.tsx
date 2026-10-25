import { money } from '../lib/rentalForms'
import type { RentalEvaluation, RentalOffer } from '../types/rental'
import { CashFlowChart } from './CashFlowChart'

interface Props { offer: RentalOffer; result: RentalEvaluation; onSave: (slot: 'A' | 'B') => void; savedSlot: 'A' | 'B' | null }

export function RentalResults({ offer, result, onSave, savedSlot }: Props) {
  const monthlyComplete = result.monthly_costs.monthly_costs_complete
  const upfrontComplete = result.upfront.upfront_cash_complete
  const totalComplete = result.lease_totals.nonrefundable_cost_complete
  const metrics = [
    ['Advertised base rent', money(offer.monthly_base_rent), 'per month'],
    [monthlyComplete ? 'Modeled monthly obligation' : 'Known monthly subtotal', money(result.monthly_costs.gross_known_monthly_housing_obligation), 'gross household'],
    [upfrontComplete ? 'Upfront move-in cash' : 'Known upfront cash subtotal', money(result.upfront.upfront_cash_required), 'includes deposits and prepaid rent'],
    [totalComplete ? 'Modeled lease expense' : 'Known lease expense subtotal', money(result.lease_totals.known_modeled_nonrefundable_lease_cost), `over ${result.lease.term_months} months; excludes refundable holds`],
    ['Refundable cash held', money(result.upfront.refundable_cash_held), 'not a lease expense; return is not guaranteed'],
    ['Monthly cash after expenses', money(result.financial_profile?.known_monthly_cash_remaining_after_housing_and_savings), result.financial_profile ? 'known estimate after savings target' : 'add a financial profile to calculate'],
  ]
  return <div className="space-y-5" aria-label="Rental evaluation results">
    <section className="surface overflow-hidden"><div className="bg-ink px-5 py-6 text-white md:px-7"><span className="text-xs font-bold uppercase tracking-[0.16em] text-[#a5d3bf]">Financial picture</span><h2 className="mt-2 font-display text-3xl">{result.rental_label}</h2><p className="mt-2 text-sm text-white/75">A deterministic calculation from the rental terms you supplied. No apartment availability or legal conclusion is inferred.</p></div><div className="grid gap-px bg-line sm:grid-cols-2 xl:grid-cols-3">{metrics.map(([label, value, note]) => <div key={label} className="bg-white p-5"><div className="text-xs font-bold uppercase tracking-wide text-muted">{label}</div><div className="mt-2 font-display text-2xl font-bold text-ink">{value}</div><div className="mt-1 text-xs text-muted">{note}</div></div>)}</div></section>
    <div className="grid gap-4 lg:grid-cols-2"><section className="surface p-5"><h3 className="text-lg font-bold">What is included</h3><p className="mt-2 text-sm text-muted">Known recurring fees: {money(result.monthly_costs.recurring_charges_known_subtotal)} / month. Utilities: {money(result.monthly_costs.utilities_known_subtotal)} known amount / month.</p><p className="mt-2 text-sm text-muted">Expected personal monthly share: {money(result.monthly_costs.expected_personal_monthly_share)}. The full household obligation still applies regardless of a roommate's expected contribution.</p><p className="mt-2 text-sm text-muted">Known total cash outflows including refundable holds: {money(result.lease_totals.known_total_cash_outflows_including_refundable_holds)}.</p></section><section className="surface p-5"><h3 className="text-lg font-bold">Completeness and sources</h3>{result.unknown_cost_categories.length ? <p className="mt-2 text-sm text-coral">Unknown categories: {result.unknown_cost_categories.map(name => name.replace(/_/g, ' ')).join(', ')}. Displayed figures are known subtotals.</p> : <p className="mt-2 text-sm text-forest">The listed cost categories are complete under the supplied terms.</p>}<p className="mt-2 text-sm text-muted">A refundable deposit is cash held up front and is not subtracted from the modeled lease expense. Check whether each number is a documented term or your own estimate.</p>{result.financial_profile && <p className="mt-2 text-sm text-muted">After known move-in cash, modeled savings: {money(result.financial_profile.initial_savings_remaining_after_known_move_in_cash)}. Affordability status: {result.financial_profile.affordability_status.replace(/_/g, ' ')}.</p>}</section></div>
    {result.warnings.length > 0 && <details className="surface p-5"><summary className="cursor-pointer font-bold">Review {result.warnings.length} calculation notes</summary><ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted">{result.warnings.map(item => <li key={item.code}>{item.message}</li>)}</ul></details>}
    <CashFlowChart months={result.month_by_month_cash_flow}/>
    <div className="flex flex-wrap items-center gap-3"><button type="button" className="min-h-11 rounded-xl bg-forest px-5 text-sm font-bold text-white" onClick={() => onSave('A')}>Save as Rental A</button><button type="button" className="min-h-11 rounded-xl border border-forest px-5 text-sm font-bold text-forest" onClick={() => onSave('B')}>Save as Rental B</button>{savedSlot && <span role="status" className="text-sm font-semibold text-forest">Saved to Rental {savedSlot} for comparison.</span>}</div>
  </div>
}
