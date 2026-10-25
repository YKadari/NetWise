import { useState, type FormEvent } from 'react'
import type { CandidateTerm, LeaseDraft, LeaseFieldId, ReviewDecision } from '../types/rental'
import { amount, money, whole } from '../lib/rentalForms'

const required: LeaseFieldId[] = ['rental_label', 'monthly_base_rent', 'lease_term_months']
const labels: Partial<Record<LeaseFieldId, string>> = { rental_label: 'Rental name', monthly_base_rent: 'Advertised monthly rent', lease_term_months: 'Lease duration', lease_start_date: 'Lease start date', occupants: 'Number of occupants', security_deposit: 'Security deposit', holding_deposit: 'Holding deposit', holding_deposit_status: 'Holding deposit status', recurring_charges: 'Recurring monthly fees', recurring_charges_status: 'Monthly fee list', utilities: 'Utilities', first_month_rent_due_upfront: "First month's rent before move-in", last_month_rent_due_upfront: "Last month's rent before move-in", nonrefundable_fees: 'Nonrefundable move-in fees', nonrefundable_fees_status: 'Move-in fee list', other_charges: 'Other upfront charges', other_charges_status: 'Other upfront charge list', concessions: 'Discounts and concessions', conditional_concessions: 'Conditions attached to discounts', early_termination: 'Early termination conditions', lease_break_fee: 'Lease break fee', notice_requirements: 'Notice requirements', renewal_or_rent_change: 'Renewal or rent changes', late_payment_fees: 'Late payment fees', roommate_liability: 'Roommate responsibility' }
const groups: [string, LeaseFieldId[]][] = [
  ['Rent and lease duration', ['rental_label', 'monthly_base_rent', 'lease_term_months', 'lease_start_date', 'occupants']],
  ['Deposits and move-in fees', ['security_deposit', 'holding_deposit', 'holding_deposit_status', 'first_month_rent_due_upfront', 'last_month_rent_due_upfront', 'nonrefundable_fees', 'nonrefundable_fees_status', 'other_charges', 'other_charges_status']],
  ['Monthly charges and utilities', ['recurring_charges', 'recurring_charges_status', 'utilities']],
  ['Discounts and concessions', ['concessions', 'conditional_concessions']],
  ['Important conditions and unanswered questions', ['early_termination', 'lease_break_fee', 'notice_requirements', 'renewal_or_rent_change', 'late_payment_fees', 'roommate_liability']],
]
const jsonFields = new Set<LeaseFieldId>(['recurring_charges', 'utilities', 'nonrefundable_fees', 'other_charges', 'holding_deposit', 'concessions'])
const numberFields = new Set<LeaseFieldId>(['monthly_base_rent', 'security_deposit', 'lease_break_fee'])
const integerFields = new Set<LeaseFieldId>(['lease_term_months', 'occupants'])
const paymentTimingFields = new Set<LeaseFieldId>(['first_month_rent_due_upfront', 'last_month_rent_due_upfront'])
const human = (value: string) => value.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
function candidateValue(field: LeaseFieldId, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'No explicit value found'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return numberFields.has(field) || field === 'monthly_base_rent' ? money(value) : field === 'lease_term_months' ? `${value} months` : field === 'occupants' ? `${value} people` : String(value)
  if (typeof value === 'string') {
    if (value === 'unknown') return 'Unknown'
    if (value === 'none') return 'Confirmed none'
    if (value === 'complete') return 'Fee list confirmed complete'
    if (value === 'included_in_rent') return 'Included in rent'
    return value
  }
  if (Array.isArray(value)) {
    if (!value.length) return field.includes('status') ? 'No charges listed; completeness is shown separately' : 'No items listed; confirm whether this means none'
    return value.map((entry, index) => {
      if (!entry || typeof entry !== 'object') return `Item ${index + 1}: ${String(entry)}`
      const item = entry as Record<string, unknown>
      const name = typeof item.name === 'string' ? item.name : `Item ${index + 1}`
      const amountValue = typeof item.monthly_amount === 'number' ? item.monthly_amount : typeof item.amount === 'number' ? item.amount : null
      const amountText = amountValue === null ? '' : ` — ${money(amountValue)}${item.frequency === 'monthly' || field === 'recurring_charges' ? ' / month' : ''}`
      const rest = Object.entries(item).filter(([key]) => !['name', 'monthly_amount', 'amount', 'frequency'].includes(key)).map(([key, val]) => `${human(key)}: ${typeof val === 'string' || typeof val === 'number' ? val : 'details provided'}`).join('; ')
      return `${name}${amountText}${rest ? ` (${rest})` : ''}`
    }).join('; ')
  }
  if (typeof value === 'object') {
    const item = value as Record<string, unknown>
    if (item.status === 'unknown') return 'Unknown'
    if (item.status === 'none') return 'Confirmed none'
    if (item.status === 'included_in_rent') return 'Included in rent'
    const amountValue = typeof item.amount === 'number' ? item.amount : typeof item.estimated_monthly_amount === 'number' ? item.estimated_monthly_amount : null
    if (amountValue !== null) return `${money(amountValue)}${field === 'utilities' || item.frequency === 'monthly' ? ' / month' : ''}${typeof item.name === 'string' ? ` — ${item.name}` : ''}${typeof item.treatment === 'string' ? ` (${human(item.treatment)})` : ''}`
    return Object.entries(item).map(([key, val]) => `${human(key)}: ${typeof val === 'string' || typeof val === 'number' ? val : 'details provided'}`).join('; ')
  }
  return 'Value needs review'
}
type Choice = { action: ReviewDecision['action'] | ''; raw: string }

export function parseReviewCorrection(field: LeaseFieldId, raw: string): unknown {
  if (!raw.trim()) throw new Error(`Enter a correction for ${labels[field] || field.replace(/_/g, ' ')}.`)
  if (field === 'monthly_base_rent') return amount(raw, 'Monthly base rent', true)
  if (numberFields.has(field)) return amount(raw, labels[field] || field)
  if (field === 'lease_term_months') return whole(raw, 'Lease duration', 1, 120)
  if (field === 'occupants') return whole(raw, 'Occupants', 1, 30)
  if (jsonFields.has(field)) {
    try { return JSON.parse(raw) as unknown }
    catch { throw new Error(`${labels[field] || field} correction must be valid JSON.`) }
  }
  return raw.trim()
}

interface Props { draft: LeaseDraft; busy: boolean; error: string | null; onConfirm: (decisions: ReviewDecision[]) => void; onBack: () => void }

export function LeaseReview({ draft, busy, error, onConfirm, onBack }: Props) {
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [localError, setLocalError] = useState<string | null>(null)
  const missing = required.filter(field => !draft.terms.some(term => term.field_id === field))
  const terms: CandidateTerm[] = [...draft.terms, ...missing.map(field => ({ field_id: field, value: null, status: 'not_found' as const, source_excerpt: null, page_reference: null, uncertainty_note: 'Required field was not extracted; enter it manually.', evidence_verification: 'missing' as const, review_state: 'needs_review' as const }))]
  const remaining = terms.filter(term => !choices[term.field_id]?.action).length
  const reviewed = terms.length - remaining
  const setChoice = (field: LeaseFieldId, patch: Partial<Choice>) => {
    setChoices(current => ({ ...current, [field]: { action: current[field]?.action || '', raw: current[field]?.raw || '', ...patch } }))
    setLocalError(null)
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (remaining) { setLocalError(`Review ${remaining} remaining field${remaining === 1 ? '' : 's'} before continuing.`); return }
    try {
      const decisions = terms.map(term => {
        const choice = choices[term.field_id]
        if (required.includes(term.field_id) && choice.action !== 'accept' && choice.action !== 'correct') throw new Error(`${labels[term.field_id]} must be accepted or corrected.`)
        return choice.action === 'correct' ? { field_id: term.field_id, action: 'correct' as const, value: parseReviewCorrection(term.field_id, choice.raw) } : { field_id: term.field_id, action: choice.action as Exclude<ReviewDecision['action'], 'correct'> }
      })
      setLocalError(null); onConfirm(decisions)
    } catch (cause) { setLocalError(cause instanceof Error ? cause.message : 'Check the reviewed terms.') }
  }
  return <form onSubmit={submit} className="space-y-5" aria-label="Review extracted lease terms">
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><strong>Human review required.</strong> Gemini can misread a lease. Excerpts marked unverified have not been matched to the source text or page. No extracted term is confirmed until you choose an action and submit the review.</div>
    {draft.general_warnings.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm text-coral">{draft.general_warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
    <div className="h-2 overflow-hidden rounded-full bg-canvas" role="progressbar" aria-label="Review progress" aria-valuemin={0} aria-valuemax={terms.length} aria-valuenow={reviewed}><div className="h-full rounded-full bg-forest transition-[width]" style={{ width: `${Math.round(reviewed / terms.length * 100)}%` }}/></div><p className="text-sm font-bold text-forest" aria-live="polite">{reviewed} of {terms.length} terms reviewed</p>
    {groups.map(([group, fields]) => { const groupTerms = terms.filter(term => fields.includes(term.field_id)); return groupTerms.length ? <section key={group} aria-label={group}><h3 className="mb-2 font-display text-lg">{group}</h3><div className="grid gap-2 lg:grid-cols-2">{groupTerms.map(term => {
      const choice = choices[term.field_id]
      const uncertain = term.status === 'ambiguous' || term.status === 'contradictory'
      const prominent = term.field_id === 'monthly_base_rent' || term.field_id === 'lease_term_months'
      return <section key={term.field_id} className={`rounded-xl border p-3 ${uncertain ? 'border-amber-400 bg-amber-50' : choice?.action ? 'border-[#b5d5c4] bg-[#f7fbf8]' : 'border-line bg-white'}`} aria-label={`Review ${labels[term.field_id] || term.field_id.replace(/_/g, ' ')}`}>
        <div className="flex flex-wrap items-start justify-between gap-2"><h4 className={`font-bold text-ink ${prominent ? 'text-lg' : ''}`}>{labels[term.field_id] || 'Additional lease term'}</h4><div className="flex gap-2"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${uncertain ? 'bg-amber-200 text-amber-950' : 'bg-canvas text-muted'}`}>{term.status.replace(/_/g, ' ')}</span>{required.includes(term.field_id) && <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-950">Required</span>}</div></div>
        <p className={`mt-1 break-words text-sm text-ink ${prominent ? 'text-base' : ''}`}>Found in lease: <strong>{candidateValue(term.field_id, term.value)}</strong></p>
        {term.source_excerpt && <blockquote className="mt-2 border-l-2 border-forest/40 pl-3 text-sm text-muted">“{term.source_excerpt}”</blockquote>}
        <p className={`mt-1 text-xs ${term.evidence_verification.startsWith('verified') ? 'font-semibold text-forest' : 'text-amber-900'}`}>{term.page_reference ? `Page ${term.page_reference} · ` : ''}Evidence: {term.evidence_verification.replace(/_/g, ' ')}{term.evidence_verification === 'unverified' ? ' — check the original document' : ''}</p>
        {term.uncertainty_note && <p className="mt-1 text-xs text-coral">{term.uncertainty_note}</p>}
        <label className="label mt-3">Your review action<select className="field mt-1" value={choice?.action || ''} onChange={event => setChoice(term.field_id, { action: event.target.value as Choice['action'] })}><option value="">Choose an action</option>{term.status === 'explicit' && <option value="accept">Accept candidate</option>}<option value="correct">Correct / enter value</option>{!required.includes(term.field_id) && !paymentTimingFields.has(term.field_id) && <><option value="mark_unknown">Mark unknown</option>{term.field_id !== 'utilities' && <option value="confirm_none">Confirm none / not applicable</option>}</>}</select></label>
        {choice?.action === 'correct' && <label className="label mt-3">Corrected value{jsonFields.has(term.field_id) ? ' (JSON)' : ''}{jsonFields.has(term.field_id) ? <textarea className="field mt-1 min-h-24 font-mono text-xs" value={choice.raw} onChange={event => setChoice(term.field_id, { raw: event.target.value })} placeholder={term.field_id === 'utilities' ? '{"status":"estimated","amount":120}' : '[]'}/> : paymentTimingFields.has(term.field_id) ? <select className="field mt-1" value={choice.raw} onChange={event => setChoice(term.field_id, { raw: event.target.value })}><option value="">Choose timing</option><option value="yes">Yes</option><option value="no">No</option><option value="unknown">Unknown</option></select> : <input className="field mt-1" value={choice.raw} onChange={event => setChoice(term.field_id, { raw: event.target.value })} placeholder={numberFields.has(term.field_id) || integerFields.has(term.field_id) ? 'Enter a number' : 'Enter corrected text'}/>}</label>}
      </section>
    })}</div></section> : null })}
    {(localError || error) && <p role="alert" className="text-sm text-red-800">{localError || error}</p>}
    {remaining > 0 && <p className="text-sm text-muted">Choose an action for all {terms.length} terms to continue. Required rent and lease length must be accepted or corrected.</p>}
    <div className="flex flex-wrap gap-2"><button type="button" className="min-h-11 rounded-xl border border-line px-5 py-2 text-sm font-bold" onClick={onBack}>Back to document</button><button type="submit" disabled={busy || remaining > 0} className="min-h-11 rounded-xl bg-forest px-5 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Confirming…' : 'Confirm reviewed terms'}</button></div>
  </form>
}
