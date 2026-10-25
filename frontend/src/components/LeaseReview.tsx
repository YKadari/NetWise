import { useState, type FormEvent } from 'react'
import type { CandidateTerm, LeaseDraft, LeaseFieldId, ReviewDecision } from '../types/rental'
import { amount, whole } from '../lib/rentalForms'

const required: LeaseFieldId[] = ['rental_label', 'monthly_base_rent', 'lease_term_months']
const labels: Partial<Record<LeaseFieldId, string>> = { rental_label: 'Rental label', monthly_base_rent: 'Monthly base rent', lease_term_months: 'Lease duration', security_deposit: 'Security deposit', recurring_charges: 'Recurring fees', recurring_charges_status: 'Recurring fee list', utilities: 'Utilities', first_month_rent_due_upfront: 'First rent before move-in', last_month_rent_due_upfront: 'Last rent before move-in', nonrefundable_fees: 'Nonrefundable fees', nonrefundable_fees_status: 'Nonrefundable fee list', other_charges: 'Other upfront charges', other_charges_status: 'Other upfront charge list', concessions: 'Concessions', lease_break_fee: 'Lease break fee' }
const jsonFields = new Set<LeaseFieldId>(['recurring_charges', 'utilities', 'nonrefundable_fees', 'other_charges', 'holding_deposit', 'concessions'])
const numberFields = new Set<LeaseFieldId>(['monthly_base_rent', 'security_deposit', 'lease_break_fee'])
const integerFields = new Set<LeaseFieldId>(['lease_term_months', 'occupants'])
const paymentTimingFields = new Set<LeaseFieldId>(['first_month_rent_due_upfront', 'last_month_rent_due_upfront'])
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
    <p className="text-sm font-bold text-forest" aria-live="polite">{remaining} of {terms.length} fields still need a decision</p>
    <div className="grid gap-3 lg:grid-cols-2">{terms.map(term => {
      const choice = choices[term.field_id]
      return <section key={term.field_id} className={`rounded-2xl border p-4 ${choice?.action ? 'border-[#b5d5c4] bg-[#f7fbf8]' : 'border-line bg-white'}`} aria-label={`Review ${labels[term.field_id] || term.field_id.replace(/_/g, ' ')}`}>
        <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-bold text-ink">{labels[term.field_id] || term.field_id.replace(/_/g, ' ')}</h3><span className="rounded-full bg-canvas px-2 py-1 text-xs font-semibold text-muted">{term.status.replace(/_/g, ' ')}</span></div>
        <p className="mt-2 break-words text-sm text-ink">Candidate: <strong>{term.value === null ? 'No explicit value found' : typeof term.value === 'string' ? term.value : JSON.stringify(term.value)}</strong></p>
        {term.source_excerpt && <blockquote className="mt-2 border-l-2 border-forest/40 pl-3 text-sm text-muted">“{term.source_excerpt}”</blockquote>}
        <p className="mt-2 text-xs text-muted">{term.page_reference ? `Page ${term.page_reference} · ` : ''}Evidence: {term.evidence_verification.replace(/_/g, ' ')}{term.evidence_verification === 'unverified' ? ' — check the original document' : ''}</p>
        {term.uncertainty_note && <p className="mt-1 text-xs text-coral">{term.uncertainty_note}</p>}
        <label className="label mt-3">Your review action<select className="field mt-1" value={choice?.action || ''} onChange={event => setChoice(term.field_id, { action: event.target.value as Choice['action'] })}><option value="">Choose an action</option>{term.status === 'explicit' && <option value="accept">Accept candidate</option>}<option value="correct">Correct / enter value</option>{!required.includes(term.field_id) && !paymentTimingFields.has(term.field_id) && <><option value="mark_unknown">Mark unknown</option>{term.field_id !== 'utilities' && <option value="confirm_none">Confirm none / not applicable</option>}</>}</select></label>
        {choice?.action === 'correct' && <label className="label mt-3">Corrected value{jsonFields.has(term.field_id) ? ' (JSON)' : ''}{jsonFields.has(term.field_id) ? <textarea className="field mt-1 min-h-24 font-mono text-xs" value={choice.raw} onChange={event => setChoice(term.field_id, { raw: event.target.value })} placeholder={term.field_id === 'utilities' ? '{"status":"estimated","amount":120}' : '[]'}/> : paymentTimingFields.has(term.field_id) ? <select className="field mt-1" value={choice.raw} onChange={event => setChoice(term.field_id, { raw: event.target.value })}><option value="">Choose timing</option><option value="yes">Yes</option><option value="no">No</option><option value="unknown">Unknown</option></select> : <input className="field mt-1" value={choice.raw} onChange={event => setChoice(term.field_id, { raw: event.target.value })} placeholder={numberFields.has(term.field_id) || integerFields.has(term.field_id) ? 'Enter a number' : 'Enter corrected text'}/>}</label>}
      </section>
    })}</div>
    {(localError || error) && <p role="alert" className="text-sm text-red-800">{localError || error}</p>}
    <div className="flex flex-wrap gap-2"><button type="button" className="min-h-11 rounded-xl border border-line px-5 py-2 text-sm font-bold" onClick={onBack}>Back to document</button><button type="submit" disabled={busy || remaining > 0} className="min-h-11 rounded-xl bg-forest px-5 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Confirming…' : 'Confirm reviewed terms'}</button></div>
  </form>
}
