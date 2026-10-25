import { useMemo, useState, type FormEvent } from 'react'
import { money } from '../lib/rentalForms'
import { buildReviewDecisions, chargeLines, findTerm, formatCandidateValue, initialReviewSummary, likelyUtilityDuplicate, validateReviewSummary, type ReviewEdit, type ReviewSummary } from '../lib/leaseReview'
import type { CandidateTerm, LeaseDraft, LeaseFieldId, ReviewDecision } from '../types/rental'
import { LeaseEvidenceDisclosure } from './LeaseEvidenceDisclosure'

interface Props { draft: LeaseDraft; busy: boolean; error: string | null; onConfirm: (decisions: ReviewDecision[]) => void; onBack: () => void }

const labels: Partial<Record<LeaseFieldId, string>> = {
  rental_label: 'Rental name', monthly_base_rent: 'Monthly rent', lease_term_months: 'Lease duration',
  lease_start_date: 'Lease start date', occupants: 'Number of occupants', security_deposit: 'Security deposit',
  holding_deposit: 'Holding deposit', holding_deposit_status: 'Holding deposit',
  first_month_rent_due_upfront: "First month's rent before move-in", last_month_rent_due_upfront: "Last month's rent before move-in",
  recurring_charges: 'Monthly fees', recurring_charges_status: 'Monthly fee list', utilities: 'Utilities',
  nonrefundable_fees: 'Nonrefundable move-in fees', nonrefundable_fees_status: 'Move-in fee list',
  other_charges: 'Other move-in charges', other_charges_status: 'Other charge list', concessions: 'Discounts or rent credits',
  conditional_concessions: 'Conditions on discounts', early_termination: 'Ending the lease early', lease_break_fee: 'Lease break fee',
  notice_requirements: 'Notice before moving out', renewal_or_rent_change: 'Renewal or rent changes',
  late_payment_fees: 'Late payment fees', roommate_liability: 'Roommate responsibility',
}
const earlyMessages: Partial<Record<LeaseFieldId, string>> = {
  early_termination: "We couldn't confirm what happens if you end the lease early.",
  lease_break_fee: "We couldn't confirm whether there is a lease break fee.",
  notice_requirements: "We couldn't confirm how much notice is required before moving out.",
  renewal_or_rent_change: "We couldn't confirm the renewal terms or possible rent changes.",
  late_payment_fees: "We couldn't confirm the fee for a late payment.",
  roommate_liability: "We couldn't confirm how roommates share responsibility for rent.",
  conditional_concessions: "We couldn't confirm the conditions attached to any discount.",
}
const numericFields = new Set<LeaseFieldId>(['security_deposit', 'lease_break_fee'])
const chargeFields = new Set<LeaseFieldId>(['recurring_charges', 'nonrefundable_fees', 'other_charges'])
const noneStatusField: Partial<Record<LeaseFieldId, LeaseFieldId>> = {
  recurring_charges: 'recurring_charges_status', nonrefundable_fees: 'nonrefundable_fees_status', other_charges: 'other_charges_status',
}
const safeEvidence = (term: CandidateTerm | undefined) => term ? <LeaseEvidenceDisclosure term={term}/> : null

function termValue(term: CandidateTerm | undefined): string {
  if (!term || term.status !== 'explicit') return 'Not confirmed'
  if (term.field_id === 'lease_term_months') return typeof term.value === 'number' ? `${term.value} months` : formatCandidateValue(term.value)
  if (term.field_id === 'monthly_base_rent' || term.field_id === 'security_deposit' || term.field_id === 'lease_break_fee') return typeof term.value === 'number' ? money(term.value) : formatCandidateValue(term.value)
  if ((term.field_id === 'first_month_rent_due_upfront' || term.field_id === 'last_month_rent_due_upfront') && typeof term.value === 'boolean') return term.value ? 'Due before move-in' : 'Not due before move-in'
  return formatCandidateValue(term.value)
}

function chargeText(term: CandidateTerm | undefined, monthly = false): string {
  if (!term || term.status !== 'explicit') return 'Not confirmed'
  const lines = chargeLines(term.value)
  if (!lines.length) return 'No charges listed; fee list still needs confirmation.'
  return lines.map(line => `${line.name}${line.amount === null ? '' : ` — ${money(line.amount)}${monthly ? ' / month' : ''}`}${line.detail ? ` (${line.detail})` : ''}`).join('; ')
}

function editorText(term: CandidateTerm | undefined, field: LeaseFieldId): string {
  const lines = chargeLines(term?.value)
  if (!lines.length) return ''
  return lines.map(line => `${line.name} | ${line.amount ?? ''}${field === 'other_charges' ? ` | ${line.detail?.includes('refundable') ? line.detail : 'nonrefundable'}` : ''}`).join('\n')
}

function parseChargeCorrection(field: LeaseFieldId, raw: string): unknown[] {
  if (!raw.trim()) return []
  return raw.split(/\r?\n/).map((line, index) => {
    const [rawName, rawAmount, rawRefundable] = line.split('|').map(value => value.trim())
    const amount = Number(rawAmount?.replace(/[$,\s]/g, ''))
    if (!rawName || !rawAmount || !Number.isFinite(amount) || amount <= 0) throw new Error(`Check charge line ${index + 1}. Enter a fee amount above $0.`)
    if (field === 'recurring_charges') return { name: rawName, monthly_amount: amount }
    return { name: rawName, amount, refundable: field === 'other_charges' && rawRefundable?.toLowerCase() === 'refundable' }
  })
}

function EvidenceRow({ label, term, value }: { label: string; term?: CandidateTerm; value: string }) {
  return <div className="border-b border-line py-3 last:border-0">
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><dt className="text-sm text-muted">{label}</dt><dd className="text-right text-sm font-semibold text-ink">{value}</dd></div>
    {term && (term.status === 'ambiguous' || term.status === 'contradictory') && <p className="mt-1 text-xs text-amber-900">The lease wording was unclear, so we left this unconfirmed.{term.uncertainty_note ? ` ${term.uncertainty_note}` : ''}</p>}
    {safeEvidence(term)}
  </div>
}

export function LeaseReview({ draft, busy, error, onConfirm, onBack }: Props) {
  const [summary, setSummary] = useState<ReviewSummary>(() => initialReviewSummary(draft))
  const [openEditor, setOpenEditor] = useState<LeaseFieldId | null>(null)
  const [chargeDraft, setChargeDraft] = useState('')
  const [utilityAmount, setUtilityAmount] = useState('')
  const [utilityStatus, setUtilityStatus] = useState<'estimated' | 'included_in_rent'>('estimated')
  const [holdingTreatment, setHoldingTreatment] = useState('credited_to_first_month_rent')
  const [localError, setLocalError] = useState<string | null>(null)
  const duplicateUtilities = useMemo(() => likelyUtilityDuplicate(draft), [draft])
  const readiness = validateReviewSummary(draft, summary)
  const updateSummary = (patch: Partial<ReviewSummary>) => setSummary(current => ({ ...current, ...patch, ...(('rentalName' in patch || 'monthlyRent' in patch || 'leaseMonths' in patch) ? { checked: false } : {}) }))
  const setEdit = (field: LeaseFieldId, edit: ReviewEdit) => setSummary(current => ({ ...current, checked: ['rental_label', 'monthly_base_rent', 'lease_term_months', 'lease_break_fee', 'security_deposit', 'holding_deposit', 'holding_deposit_status', 'first_month_rent_due_upfront', 'last_month_rent_due_upfront', 'nonrefundable_fees', 'nonrefundable_fees_status', 'other_charges', 'other_charges_status', 'recurring_charges', 'recurring_charges_status', 'utilities', 'concessions'].includes(field) ? false : current.checked, edits: { ...current.edits, [field]: edit } }))
  const open = (field: LeaseFieldId) => {
    const term = findTerm(draft, field)
    setOpenEditor(field)
    setChargeDraft(editorText(term, field))
    const utility = term?.value && typeof term.value === 'object' && !Array.isArray(term.value) ? term.value as Record<string, unknown> : null
    setUtilityStatus(utility?.status === 'included_in_rent' ? 'included_in_rent' : 'estimated')
    const utilityValue = utility?.amount ?? utility?.estimated_monthly_amount ?? (typeof term?.value === 'number' ? term.value : undefined)
    setUtilityAmount(typeof utilityValue === 'number' ? String(utilityValue) : '')
    const holding = term?.value && typeof term.value === 'object' && !Array.isArray(term.value) ? term.value as Record<string, unknown> : null
    setHoldingTreatment(typeof holding?.treatment === 'string' ? holding.treatment : 'credited_to_first_month_rent')
  }
  const applyChargeEdit = (field: LeaseFieldId) => {
    try { setEdit(field, { action: 'correct', value: parseChargeCorrection(field, chargeDraft) }); setLocalError(null); setOpenEditor(null) }
    catch (cause) { setLocalError(cause instanceof Error ? cause.message : 'Check the charge details.') }
  }
  const markNoCharges = (field: LeaseFieldId) => {
    setEdit(field, { action: 'confirm_none' })
    const status = noneStatusField[field]
    if (status) setEdit(status, { action: 'confirm_none' })
  }
  const beginEdit = (field: LeaseFieldId) => { setLocalError(null); open(field) }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    try { onConfirm(buildReviewDecisions(draft, summary)); setLocalError(null) }
    catch (cause) { setLocalError(cause instanceof Error ? cause.message : 'Check the rental details before continuing.') }
  }

  const simpleEditor = (term: CandidateTerm, field: LeaseFieldId) => {
    if (chargeFields.has(field)) return <div className="mt-3 space-y-2">
      <label className="label">One charge per line: name | amount{field === 'other_charges' ? ' | refundable or nonrefundable' : ''}<textarea className="field mt-1 min-h-24" value={chargeDraft} onChange={event => setChargeDraft(event.target.value)} placeholder={field === 'recurring_charges' ? 'Internet | 40\nParking | 100' : 'Application fee | 100'}/></label>
      <div className="flex flex-wrap gap-2"><button type="button" className="rounded-lg bg-forest px-3 py-2 text-sm font-bold text-white" onClick={() => applyChargeEdit(field)}>Save corrected charges</button><button type="button" className="rounded-lg border border-line px-3 py-2 text-sm font-semibold" onClick={() => markNoCharges(field)}>Confirm none apply</button></div>
    </div>
    if (field === 'utilities') return <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <label className="label">Utilities<select className="field mt-1" value={utilityStatus} onChange={event => setUtilityStatus(event.target.value as typeof utilityStatus)}><option value="estimated">Estimated monthly amount</option><option value="included_in_rent">Included in rent</option></select></label>
      {utilityStatus === 'estimated' && <label className="label">Monthly estimate<input className="field mt-1" type="number" min="0" step="0.01" value={utilityAmount} onChange={event => setUtilityAmount(event.target.value)} placeholder="Enter amount"/></label>}
      <button type="button" className="w-fit rounded-lg bg-forest px-3 py-2 text-sm font-bold text-white sm:col-span-2" onClick={() => { const value = utilityStatus === 'included_in_rent' ? { status: 'included_in_rent' } : { status: 'estimated', amount: Number(utilityAmount), source_description: 'User correction' }; if (utilityStatus === 'estimated' && (!utilityAmount || !Number.isFinite(Number(utilityAmount)) || Number(utilityAmount) < 0)) { setLocalError('Enter a valid monthly utility estimate, or choose included in rent.'); return } setEdit(field, { action: 'correct', value }); setOpenEditor(null) }}>Save utility details</button>
    </div>
    if (field === 'holding_deposit') return <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <label className="label">Holding deposit amount<input className="field mt-1" type="number" min="0.01" step="0.01" defaultValue={term.value && typeof term.value === 'object' && !Array.isArray(term.value) && typeof (term.value as Record<string, unknown>).amount === 'number' ? String((term.value as Record<string, unknown>).amount) : ''} onChange={event => setUtilityAmount(event.target.value)} placeholder="Enter amount"/></label>
      <label className="label">How it is applied<select className="field mt-1" value={holdingTreatment} onChange={event => setHoldingTreatment(event.target.value)}><option value="credited_to_security_deposit">Credited to security deposit</option><option value="credited_to_first_month_rent">Credited to first month's rent</option><option value="credited_to_last_month_rent">Credited to last month's rent</option><option value="credited_to_nonrefundable_fees">Credited to fees</option><option value="not_credited_refundable">Refundable, not credited</option><option value="not_credited_nonrefundable">Not refundable or credited</option></select></label>
      <button type="button" className="w-fit rounded-lg bg-forest px-3 py-2 text-sm font-bold text-white" onClick={() => { const amount = Number(utilityAmount); if (!Number.isFinite(amount) || amount <= 0) { setLocalError('Enter the holding deposit amount.'); return } setEdit(field, { action: 'correct', value: { amount, treatment: holdingTreatment } }); setOpenEditor(null) }}>Save holding deposit</button>
    </div>
    if (field === 'first_month_rent_due_upfront' || field === 'last_month_rent_due_upfront') return <label className="label mt-3 block">Is it due before move-in?<select className="field mt-1" defaultValue="" onChange={event => { if (event.target.value) { setEdit(field, { action: 'correct', value: event.target.value }); setOpenEditor(null) } }}><option value="">Choose an answer</option><option value="yes">Yes</option><option value="no">No</option><option value="unknown">I don't know</option></select></label>
    const initial = field === 'security_deposit' || field === 'lease_break_fee' ? (typeof term.value === 'number' ? String(term.value) : '') : typeof term.value === 'string' ? term.value : ''
    return <div className="mt-3 space-y-2"><label className="label block">Your corrected details<input className="field mt-1" type={numericFields.has(field) ? 'number' : 'text'} min={numericFields.has(field) ? '0' : undefined} step={numericFields.has(field) ? '0.01' : undefined} defaultValue={initial} placeholder={numericFields.has(field) ? 'Enter amount' : 'Enter details'} onChange={event => setUtilityAmount(event.target.value)}/></label><button type="button" className="rounded-lg bg-forest px-3 py-2 text-sm font-bold text-white" onClick={() => { const raw = utilityAmount.trim(); if (!raw) { setLocalError(numericFields.has(field) ? 'Enter an amount.' : 'Enter the corrected details.'); return } const value = numericFields.has(field) ? Number(raw) : raw; if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) { setLocalError('Enter a valid nonnegative amount.'); return } setEdit(field, { action: 'correct', value }); setOpenEditor(null) }}>Save correction</button></div>
  }

  const editableFinancial = (field: LeaseFieldId, label: string) => {
    const term = findTerm(draft, field)
    const edit = summary.edits[field]
    let value = edit?.action === 'mark_unknown' ? 'Not confirmed' : edit?.action === 'confirm_none' ? 'Confirmed none' : edit?.action === 'correct' ? formatCandidateValue(edit.value) : termValue(term)
    if (field === 'recurring_charges') value = edit?.action === 'correct' ? chargeText({ ...(term || { field_id: field, status: 'explicit', value: null, source_excerpt: null, page_reference: null, uncertainty_note: null, evidence_verification: 'missing', review_state: 'needs_review' }), value: edit.value, status: 'explicit' }, true) : chargeText(term, true)
    if (field === 'nonrefundable_fees' || field === 'other_charges') value = edit?.action === 'correct' ? chargeText({ ...(term || { field_id: field, status: 'explicit', value: null, source_excerpt: null, page_reference: null, uncertainty_note: null, evidence_verification: 'missing', review_state: 'needs_review' }), value: edit.value, status: 'explicit' }) : chargeText(term)
    if (field === 'utilities' && edit?.action === 'correct') value = formatCandidateValue(edit.value)
    if (field === 'first_month_rent_due_upfront' || field === 'last_month_rent_due_upfront') value = edit?.action === 'correct' ? (edit.value === 'yes' ? 'Due before move-in' : edit.value === 'no' ? 'Not due before move-in' : 'Not confirmed') : termValue(term)
    return <div key={field} className="border-b border-line py-3 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline justify-between gap-x-4"><dt className="text-sm text-muted">{label}</dt><dd className="text-right text-sm font-semibold text-ink">{value}</dd></div>{term && (term.status === 'ambiguous' || term.status === 'contradictory') && <p className="mt-1 text-xs text-amber-900">The lease wording was unclear, so we left this unconfirmed.{term.uncertainty_note ? ` ${term.uncertainty_note}` : ''}</p>}{field.endsWith('_status') && value === 'Not confirmed' && <p className="mt-1 text-xs text-amber-900">We couldn't confirm whether the list is complete.</p>}{safeEvidence(term)}</div>{field.endsWith('_status') ? <button type="button" className="rounded-md px-2 py-1 text-xs font-bold text-forest underline" onClick={() => setEdit(field, { action: 'confirm_none' })}>I've checked this list</button> : <div className="flex gap-2">{field === 'holding_deposit' && <button type="button" className="rounded-md px-2 py-1 text-xs font-bold text-forest underline" onClick={() => { setEdit('holding_deposit', { action: 'confirm_none' }); setEdit('holding_deposit_status', { action: 'confirm_none' }) }}>Confirm no holding deposit</button>}<button type="button" className="rounded-md px-2 py-1 text-xs font-bold text-forest underline" onClick={() => beginEdit(field)}>{edit?.action === 'correct' ? 'Edit' : 'Edit details'}</button></div>}</div>
      {openEditor === field && <div className="mt-2 rounded-lg border border-line bg-white p-3">{simpleEditor(term || { field_id: field, value: null, status: 'not_found', source_excerpt: null, page_reference: null, uncertainty_note: null, evidence_verification: 'missing', review_state: 'needs_review' }, field)}<div className="mt-2 flex flex-wrap gap-2"><button type="button" className="rounded-lg border border-line px-3 py-2 text-sm font-semibold" onClick={() => { setEdit(field, { action: 'mark_unknown' }); setOpenEditor(null) }}>Leave unconfirmed</button>{field === 'security_deposit' && <button type="button" className="rounded-lg border border-line px-3 py-2 text-sm font-semibold" onClick={() => { setEdit(field, { action: 'confirm_none' }); setOpenEditor(null) }}>Confirm no deposit</button>}</div></div>}
      {field === 'recurring_charges' && duplicateUtilities.length > 0 && !summary.edits.recurring_charges && <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><strong>Check for a duplicate:</strong> “{duplicateUtilities.join(', ')}” may also be counted under Utilities. Choose whether these are separate costs, or edit the fee list to remove the repeated item before confirming.<div className="mt-2 flex flex-wrap gap-2"><button type="button" className="rounded-lg border border-amber-700 px-3 py-2 text-sm font-semibold" onClick={() => setEdit('recurring_charges', { action: 'accept' })}>These are separate costs</button><button type="button" className="rounded-lg border border-amber-700 px-3 py-2 text-sm font-semibold" onClick={() => beginEdit('recurring_charges')}>Edit the fee list</button></div></div>}
    </div>
  }

  const clauseCards = draft.terms.filter(term => ['early_termination', 'lease_break_fee', 'notice_requirements', 'renewal_or_rent_change', 'late_payment_fees', 'roommate_liability', 'conditional_concessions'].includes(term.field_id))
  const clauseIds = new Set(clauseCards.map(term => term.field_id))
  const missingClauseIds: LeaseFieldId[] = ['early_termination', 'lease_break_fee', 'notice_requirements', 'renewal_or_rent_change', 'late_payment_fees', 'roommate_liability', 'conditional_concessions'].filter(field => !clauseIds.has(field as LeaseFieldId)) as LeaseFieldId[]

  return <form onSubmit={submit} className="space-y-5" aria-label="Review lease summary">
    <header><div className="kicker">Lease review</div><h2 className="mt-1 font-display text-2xl">Here's what we found in your lease.</h2><p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">We've organized the important costs and conditions. Check the details before we calculate what this rental could cost.</p></header>
    {draft.general_warnings.length > 0 && <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><strong>Worth a closer look</strong><ul className="mt-2 list-disc space-y-1 pl-5">{draft.general_warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}

    <section className="surface p-4 sm:p-5" aria-label="Essential rental details"><h3 className="font-display text-xl">Essential rental details</h3><div className="mt-3 grid gap-3 md:grid-cols-3">
      <label className="label">Rental name <span className="font-normal text-muted">(just for you)</span><input className="field mt-1" value={summary.rentalName} onChange={event => updateSummary({ rentalName: event.target.value })} maxLength={120} placeholder="e.g. Downtown apartment"/></label>
      <label className="label">Monthly rent<input className="field mt-1" type="number" min="0.01" step="0.01" inputMode="decimal" value={summary.monthlyRent} onChange={event => updateSummary({ monthlyRent: event.target.value })} placeholder="Enter monthly rent"/></label>
      <label className="label">Lease duration in months<input className="field mt-1" type="number" min="1" max="120" step="1" inputMode="numeric" value={summary.leaseMonths} onChange={event => updateSummary({ leaseMonths: event.target.value })} placeholder="Enter number of months"/></label>
    </div><div className="mt-3 grid gap-x-6 md:grid-cols-2">{(['rental_label', 'monthly_base_rent', 'lease_term_months'] as LeaseFieldId[]).map(field => <div key={field} className="text-xs text-muted">{labels[field]}{findTerm(draft, field) ? ` found: ${termValue(findTerm(draft, field))}` : ' was not found in the lease.'}{safeEvidence(findTerm(draft, field))}</div>)}</div></section>

    <section className="surface p-4 sm:p-5" aria-label="Move-in costs"><h3 className="font-display text-xl">Move-in costs</h3><p className="mt-1 text-sm text-muted">These are separate types of payment. The final cash calculation comes from the rental evaluator after review.</p><dl className="mt-2">
      {editableFinancial('security_deposit', 'Security deposit')}
      {editableFinancial('holding_deposit', 'Holding deposit')}
      {editableFinancial('first_month_rent_due_upfront', "First month's rent before move-in")}
      {editableFinancial('last_month_rent_due_upfront', "Last month's rent before move-in")}
      {editableFinancial('nonrefundable_fees', 'Application and other nonrefundable fees')}
      {editableFinancial('nonrefundable_fees_status', 'Nonrefundable fee list')}
      {editableFinancial('other_charges', 'Other identified move-in charges')}
      {editableFinancial('other_charges_status', 'Other charge list')}
    </dl><p className="mt-3 rounded-lg bg-canvas p-3 text-xs text-muted">We don't add a preliminary upfront total here. Prepaid rent, refundable deposits, and nonrefundable fees are handled separately in your final calculation.</p></section>

    <section className="surface p-4 sm:p-5" aria-label="Monthly costs"><h3 className="font-display text-xl">Monthly costs</h3><dl className="mt-2">
      <EvidenceRow label="Base monthly rent" term={findTerm(draft, 'monthly_base_rent')} value={summary.monthlyRent.trim() ? money(Number(summary.monthlyRent)) : 'Enter monthly rent'} />
      {editableFinancial('recurring_charges', 'Other recurring fees')}
      {editableFinancial('recurring_charges_status', 'Monthly fee list')}
      {editableFinancial('utilities', 'Utilities')}
      {editableFinancial('concessions', 'Discounts or rent credits')}
    </dl></section>

    <section className="surface p-4 sm:p-5" aria-label="Things worth checking"><h3 className="font-display text-xl">Things worth checking</h3><p className="mt-1 text-sm text-muted">Missing information stays unconfirmed. It doesn't mean that a fee or condition does not exist.</p><ul className="mt-3 space-y-3">{[...clauseCards.map(term => ({ field: term.field_id, term })), ...missingClauseIds.map(field => ({ field, term: undefined }))].map(({ field, term }) => {
      const edit = summary.edits[field]
      const shown = edit?.action === 'accept' ? 'Reviewed from the lease' : edit?.action === 'confirm_none' ? 'You confirmed this does not apply' : edit?.action === 'correct' ? formatCandidateValue(edit.value) : edit?.action === 'mark_unknown' || !term || term.status !== 'explicit' ? (earlyMessages[field] || `We couldn't confirm ${labels[field]?.toLowerCase() || 'this term'}.`) : `Found in lease: ${formatCandidateValue(term.value)} — not confirmed yet.`
      const mayConfirmNone = field === 'lease_break_fee' || field === 'late_payment_fees' || field === 'conditional_concessions'
      return <li key={field} className="rounded-xl border border-line bg-white p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0 flex-1"><h4 className="text-sm font-bold text-ink">{labels[field]}</h4><p className="mt-1 text-sm text-muted">{shown}</p>{term && safeEvidence(term)}</div><div className="flex flex-wrap gap-2">{term?.status === 'explicit' && <button type="button" className="rounded-lg border border-line px-3 py-2 text-xs font-bold text-forest" onClick={() => setEdit(field, { action: 'accept' })}>I checked this clause</button>}{mayConfirmNone && <button type="button" className="rounded-lg border border-line px-3 py-2 text-xs font-semibold" onClick={() => setEdit(field, { action: 'confirm_none' })}>Confirm this doesn't apply</button>}<button type="button" className="rounded-lg border border-line px-3 py-2 text-xs font-semibold" onClick={() => beginEdit(field)}>{field === 'lease_break_fee' ? 'Correct fee' : 'Add or correct detail'}</button>{term?.status === 'explicit' && <button type="button" className="rounded-lg border border-line px-3 py-2 text-xs font-semibold" onClick={() => setEdit(field, { action: 'mark_unknown' })}>Leave unconfirmed</button>}</div></div>{openEditor === field && <div className="mt-2">{simpleEditor(term || { field_id: field, value: null, status: 'not_found', source_excerpt: null, page_reference: null, uncertainty_note: null, evidence_verification: 'missing', review_state: 'needs_review' }, field)}</div>}</li>
    })}</ul></section>

    <section className="rounded-xl border-2 border-forest bg-[#f4faf6] p-4 sm:p-5"><label className="flex cursor-pointer items-start gap-3 text-sm font-semibold text-ink"><input className="mt-1 h-5 w-5 accent-forest" type="checkbox" checked={summary.checked} onChange={event => updateSummary({ checked: event.target.checked })}/><span>I've checked the rental name, rent, lease duration, and costs shown above against my lease. Any edits I made are correct.</span></label><p role="status" className="mt-2 text-sm text-forest">{readiness || 'Ready to calculate.'}</p></section>
    {(localError || error) && <p role="alert" className="text-sm text-red-800">{localError || error}</p>}
    <div className="flex flex-wrap gap-3"><button type="button" className="min-h-11 rounded-xl border border-line px-5 py-2 text-sm font-bold" onClick={onBack}>Back to my lease</button><button type="submit" disabled={busy || Boolean(readiness)} className="min-h-11 rounded-xl bg-forest px-5 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Confirming lease…' : 'See my rental costs'}</button></div>
  </form>
}
