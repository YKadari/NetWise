import { useState, type FormEvent } from 'react'
import { amount, money, whole } from '../lib/rentalForms'
import type { RentalOffer, StressResult, StressScenario } from '../types/rental'

interface Props { offer: RentalOffer; busy: boolean; error: string | null; result: StressResult | null; onRun: (scenario: StressScenario) => void }
type Kind = StressScenario['type']
type Treatment = Extract<StressScenario, { type: 'early_departure' }>['treatment']
const summaryMoney = (section: unknown, field: string): number | null => {
  if (!section || typeof section !== 'object') return null
  const value = (section as Record<string, unknown>)[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function RentalStressPanel({ offer, busy, error, result, onRun }: Props) {
  const [kind, setKind] = useState<Kind | null>(null)
  const [extra, setExtra] = useState('100')
  const [lost, setLost] = useState('')
  const [first, setFirst] = useState('1')
  const [last, setLast] = useState(String(offer.lease_term_months))
  const [departure, setDeparture] = useState(String(Math.max(1, offer.lease_term_months - 4)))
  const [treatment, setTreatment] = useState<Treatment>('unknown_consequences')
  const [fee, setFee] = useState('')
  const [source, setSource] = useState('')
  const [note, setNote] = useState('')
  const [remaining, setRemaining] = useState<'unknown' | 'specified' | 'none_confirmed'>('unknown')
  const [rent, setRent] = useState('')
  const [rentMonths, setRentMonths] = useState('')
  const [deposit, setDeposit] = useState<'unknown' | 'withheld' | 'refunded'>('unknown')
  const [depositNote, setDepositNote] = useState('')
  const [prepaid, setPrepaid] = useState<'unknown' | 'retained' | 'refunded'>('unknown')
  const [localError, setLocalError] = useState<string | null>(null)
  const unknownDepartureOutcome = result?.scenario_type === 'early_departure' && result.assumptions.treatment === 'unknown_consequences'
  const unknownFutureRent = result?.scenario_type === 'early_departure' && (result.assumptions.treatment === 'unknown_consequences' || result.assumptions.remaining_rent_treatment === 'unknown')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (busy || !kind) return
    const selectedKind = kind
    try {
      let scenario: StressScenario
      if (selectedKind !== 'early_departure') {
        const first_affected_month = whole(first, 'First affected month', 1, offer.lease_term_months)
        const last_affected_month = whole(last, 'Last affected month', first_affected_month, offer.lease_term_months)
        scenario = selectedKind === 'utility_increase'
          ? { type: selectedKind, additional_monthly_amount: amount(extra, 'Additional monthly utilities', true), first_affected_month, last_affected_month }
          : { type: selectedKind, monthly_contribution_lost: amount(lost, 'Lost roommate contribution', true), first_affected_month, last_affected_month }
      } else {
        const departure_month = whole(departure, 'Departure month', 1, offer.lease_term_months - 1)
        if (treatment === 'unknown_consequences') scenario = { type: selectedKind, departure_month, treatment }
        else {
          const remaining_rent_treatment = treatment === 'continuing_lease_obligations' ? 'specified' : remaining
          const explicitRent = remaining_rent_treatment === 'specified' ? { continuing_rent_monthly_amount: amount(rent, 'Continuing rent', true), continuing_rent_months: whole(rentMonths, 'Continuing rent months', 1, offer.lease_term_months - departure_month) } : {}
          if ((treatment === 'hypothetical_settlement' || treatment === 'continuing_lease_obligations') && !note.trim()) throw new Error('Describe the source or assumption for this early-departure scenario.')
          if (deposit !== 'unknown' && (!depositNote.trim() || offer.upfront?.security_deposit?.status !== 'provided')) throw new Error('A deposit outcome needs a known deposit amount and a written assumption.')
          if (prepaid === 'refunded' && offer.upfront?.last_month_rent_due_upfront !== 'yes') throw new Error('A prepaid-rent refund requires a known future prepaid rent month.')
          const feeDetails = treatment === 'known_contractual_termination'
            ? (() => { if (!source.trim()) throw new Error('Enter the reviewed lease source for the contractual termination fee.'); return { termination_fee: amount(fee, 'Termination fee'), termination_fee_source: source.trim(), termination_fee_provenance: { source_type: 'user_entered' as const, source_reference: source.trim(), review_state: 'confirmed' as const, reviewed_by_user: true } } })()
            : treatment === 'hypothetical_settlement' ? { termination_fee: amount(fee, 'Hypothetical settlement fee') } : {}
          scenario = { type: selectedKind, departure_month, treatment, remaining_rent_treatment, ...explicitRent, ...feeDetails,
            ...((treatment === 'hypothetical_settlement' || treatment === 'continuing_lease_obligations' || note.trim()) ? { assumption_note: note.trim() } : {}),
            deposit_treatment: deposit, ...(deposit !== 'unknown' ? { deposit_treatment_note: depositNote.trim() } : {}), prepaid_rent_treatment: prepaid }
        }
      }
      setLocalError(null); onRun(scenario)
    } catch (cause) { setLocalError(cause instanceof Error ? cause.message : 'Check the scenario assumptions.') }
  }
  const affectedRows = result?.stressed.month_by_month.filter(row => row.affected === true || result.scenario_type === 'early_departure' && typeof row.month === 'number' && result.affected_months.includes(row.month)) ?? []
  return <section className="mt-4" aria-label="Financial stress scenarios"><div className="grid gap-3 sm:grid-cols-3">{([['utility_increase', 'Utilities become more expensive'], ['roommate_contribution_loss', 'A roommate stops contributing'], ['early_departure', 'You need to leave early']] as const).map(([id, title]) => <button key={id} type="button" aria-pressed={kind === id} onClick={() => { setKind(id); setLocalError(null) }} className={`min-h-16 rounded-xl border p-3 text-left text-sm font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest ${kind === id ? 'border-forest bg-mint text-forest' : 'border-line bg-white hover:border-forest'}`}>{title}</button>)}</div>
    {kind && <form onSubmit={submit} className="mt-4 space-y-4 rounded-xl border border-line bg-canvas p-4"><div className="text-sm font-semibold text-ink">{kind === 'utility_increase' ? 'Add an expected monthly utility increase.' : kind === 'roommate_contribution_loss' ? 'Enter the contribution that would stop.' : 'Enter only reviewed or clearly hypothetical terms.'}</div>
      {kind !== 'early_departure' ? <div className="grid gap-3 sm:grid-cols-3"><label className="label">{kind === 'utility_increase' ? 'Additional utilities / month' : 'Lost roommate contribution / month'}<input className="field mt-1" type="number" min="0.01" step="0.01" value={kind === 'utility_increase' ? extra : lost} onChange={event => kind === 'utility_increase' ? setExtra(event.target.value) : setLost(event.target.value)}/></label><label className="label">First affected month<input className="field mt-1" type="number" min="1" max={offer.lease_term_months} value={first} onChange={event => setFirst(event.target.value)}/></label><label className="label">Last affected month<input className="field mt-1" type="number" min="1" max={offer.lease_term_months} value={last} onChange={event => setLast(event.target.value)}/></label></div> : <div className="space-y-4"><p className="rounded-xl bg-canvas p-3 text-sm text-muted">Moving out does not automatically end rent obligations. Legal and contractual consequences remain unknown unless you enter reviewed terms. The model does not invent a lease-break fee or assume a settlement replaces or stacks with continuing rent; each amount below is a separate explicit assumption.</p><div className="grid gap-3 sm:grid-cols-2"><label className="label">Last month of occupancy<input className="field mt-1" type="number" min="1" max={offer.lease_term_months - 1} value={departure} onChange={event => setDeparture(event.target.value)}/></label><label className="label">Treatment<select className="field mt-1" value={treatment} onChange={event => setTreatment(event.target.value as Treatment)}><option value="unknown_consequences">Consequences unknown</option><option value="hypothetical_settlement">Hypothetical settlement</option><option value="continuing_lease_obligations">Explicit continuing rent</option><option value="known_contractual_termination">Reviewed contractual termination</option></select></label></div>
        {treatment !== 'unknown_consequences' && <div className="grid gap-3 sm:grid-cols-2">{(treatment === 'hypothetical_settlement' || treatment === 'known_contractual_termination') && <label className="label">{treatment === 'hypothetical_settlement' ? 'Hypothetical fee' : 'Contractual termination fee'}<input className="field mt-1" type="number" min="0" step="0.01" value={fee} onChange={event => setFee(event.target.value)}/></label>}{treatment === 'known_contractual_termination' && <label className="label">Reviewed lease source / clause<input className="field mt-1" value={source} onChange={event => setSource(event.target.value)} placeholder="For example, section 12"/></label>}<label className="label">Remaining rent<select className="field mt-1" disabled={treatment === 'continuing_lease_obligations'} value={treatment === 'continuing_lease_obligations' ? 'specified' : remaining} onChange={event => setRemaining(event.target.value as typeof remaining)}><option value="unknown">Unknown</option><option value="specified">Explicit amount and months</option><option value="none_confirmed">Explicitly assumed none</option></select></label>{(treatment === 'continuing_lease_obligations' || remaining === 'specified') && <><label className="label">Continuing rent / month<input className="field mt-1" type="number" min="0.01" step="0.01" value={rent} onChange={event => setRent(event.target.value)}/></label><label className="label">Number of continuing months<input className="field mt-1" type="number" min="1" value={rentMonths} onChange={event => setRentMonths(event.target.value)}/></label></>}<label className="label sm:col-span-2">{treatment === 'known_contractual_termination' ? 'Additional assumption note (optional)' : 'Assumption or source note'}<input className="field mt-1" value={note} onChange={event => setNote(event.target.value)} placeholder="State what is hypothetical or where this term came from"/></label><label className="label">Deposit outcome<select className="field mt-1" value={deposit} onChange={event => setDeposit(event.target.value as typeof deposit)}><option value="unknown">Unknown</option><option value="withheld">Assume withheld</option><option value="refunded">Assume refunded</option></select></label>{deposit !== 'unknown' && <label className="label">Deposit assumption note<input className="field mt-1" value={depositNote} onChange={event => setDepositNote(event.target.value)}/></label>}<label className="label">Prepaid future rent<select className="field mt-1" value={prepaid} onChange={event => setPrepaid(event.target.value as typeof prepaid)}><option value="unknown">Unknown</option><option value="retained">Retained and applied</option><option value="refunded">Assume refunded</option></select></label></div>}
      </div>}
      {(localError || error) && <p role="alert" className="text-sm text-red-800">{localError || error}</p>}
      <button type="submit" disabled={busy} className="min-h-11 rounded-xl bg-ink px-5 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Calculating…' : 'Run scenario'}</button>
    </form>}
    {result && <div className="mt-6 space-y-4 border-t border-line pt-5" aria-live="polite"><h3 className="text-lg font-bold">{result.scenario_type.replace(/_/g, ' ')} outcome</h3><p className="text-sm text-muted">{unknownDepartureOutcome ? 'No legal or contractual outcome has been entered. Moving out does not itself end the lease; future rent, fees, and utility responsibilities remain unknown.' : result.explanation}</p><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-canvas p-4"><div className="text-xs font-bold uppercase text-muted">Affected months</div><div className="mt-1 text-xl font-bold">{result.affected_months.length ? result.affected_months.join(', ') : 'None'}</div></div><div className="rounded-xl bg-canvas p-4"><div className="text-xs font-bold uppercase text-muted">{result.scenario_type === 'early_departure' ? 'Known one-time amounts entered' : 'Additional personal burden'}</div><div className="mt-1 text-xl font-bold">{money(result.scenario_type === 'early_departure' ? result.stressed.known_departure_cash_impact : result.summary.total_additional_personal_cash_burden as number | null)}</div></div><div className="rounded-xl bg-canvas p-4"><div className="text-xs font-bold uppercase text-muted">{result.scenario_type === 'early_departure' ? unknownFutureRent ? 'Future rent and legal consequences' : 'Remaining rent under the scenario' : 'Baseline → stressed modeled burden'}</div><div className="mt-1 text-lg font-bold">{result.scenario_type === 'early_departure' ? unknownFutureRent ? 'Unknown' : money(result.stressed.specified_remaining_rent) : `${money(summaryMoney(result.summary.baseline, 'total_modeled_personal_housing_burden'))} → ${money(summaryMoney(result.summary.stressed, 'total_modeled_personal_housing_burden'))}`}</div></div></div>
      {result.scenario_type === 'early_departure' && <p className="text-sm text-muted">{unknownFutureRent ? 'No prepaid credit has been applied to an unspecified future-rent amount. Continuing rent cash due is unknown.' : `Applied prepaid credit: ${money(result.stressed.prepaid_rent_credit_applied)}. Continuing rent cash due after credit: ${money(result.stressed.continuing_rent_cash_due_after_prepaid_credit)}.`} A hypothetical settlement is not an established legal obligation.</p>}
      <p className="text-sm text-muted">Baseline modeled savings minimum: {money((result.summary.baseline as Record<string, number> | undefined)?.minimum_modeled_savings ?? (result.summary.baseline_financial_resilience as Record<string, number> | undefined)?.minimum_modeled_savings)}. Stressed modeled savings minimum: {money((result.summary.stressed as Record<string, number> | undefined)?.minimum_modeled_savings ?? (result.summary.stressed_financial_resilience as Record<string, number> | undefined)?.minimum_modeled_savings)}. These figures appear only when a financial profile is provided.</p>
      {Array.isArray(result.summary.unknown_cost_categories) && result.summary.unknown_cost_categories.length > 0 && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">Unresolved: {(result.summary.unknown_cost_categories as string[]).map(item => item.replace(/_/g, ' ')).join(', ')}. The known impact is not a complete total.</p>}
      {affectedRows.length > 0 && <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead><tr className="border-b border-line"><th className="px-2 py-2">Month</th><th className="px-2 py-2">Baseline personal / rent</th><th className="px-2 py-2">Stressed personal / known rent</th><th className="px-2 py-2">Additional burden / rent cash due</th></tr></thead><tbody>{affectedRows.map(row => <tr key={String(row.month)} className="border-b border-line/70"><th className="px-2 py-2">{row.month}</th><td className="px-2 py-2">{money((row.baseline_personal_housing_burden ?? row.baseline_gross_household_obligation) as number | null)}</td><td className="px-2 py-2">{money((row.stressed_personal_housing_burden ?? row.stressed_known_rent_obligation) as number | null)}</td><td className="px-2 py-2">{money((row.additional_personal_cash_burden ?? row.stressed_rent_cash_due) as number | null)}</td></tr>)}</tbody></table></div>}
      {result.warnings.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm text-muted">{result.warnings.map(item => <li key={item.code}>{item.message}</li>)}</ul>}
    </div>}
  </section>
}
