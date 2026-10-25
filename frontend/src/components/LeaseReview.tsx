import { useMemo, useState, type FormEvent } from 'react'
import { money } from '../lib/rentalForms'
import { acceptedShape, buildReviewDecisions, chargeLines, financialSummaryFields, findTerm, formatCandidateValue, initialReviewSummary, likelyUtilityDuplicate, validateReviewSummary, type ReviewEdit, type ReviewSummary } from '../lib/leaseReview'
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
const safeEvidence = (term: CandidateTerm | undefined) => term && term.status !== 'not_found' ? <LeaseEvidenceDisclosure term={term}/> : null

function termValue(term: CandidateTerm | undefined): string {
  if (!term || term.status !== 'explicit') return 'Not confirmed'
  if (term.field_id === 'lease_term_months') return typeof term.value === 'number' ? `${term.value} months` : formatCandidateValue(term.value)
  if (term.field_id === 'monthly_base_rent' || term.field_id === 'security_deposit' || term.field_id === 'lease_break_fee') return typeof term.value === 'number' ? money(term.value) : formatCandidateValue(term.value)
  if (term.field_id === 'first_month_rent_due_upfront' || term.field_id === 'last_month_rent_due_upfront') return term.value === true || term.value === 'yes' ? 'Due before move-in' : term.value === false || term.value === 'no' ? 'Not due before move-in' : 'Not confirmed'
  if (term.field_id === 'concessions' && Array.isArray(term.value)) return term.value.map(item => item && typeof item === 'object' ? `${item.kind === 'free_rent_month' ? 'Free rent' : 'Rent credit'} in month ${item.month ?? '?'}${typeof item.amount === 'number' ? `: ${money(item.amount)}` : ''}` : 'Discount needs review').join('; ') || 'No discounts identified'
  return formatCandidateValue(term.value)
}

function chargeText(term: CandidateTerm | undefined, monthly = false): string {
  if (!term || term.status !== 'explicit') return 'Not confirmed'
  const lines = chargeLines(term.value)
  if (!lines.length) return 'No charges listed; fee list still needs confirmation.'
  return lines.map(line => `${line.name}${line.amount === null ? '' : ` — ${money(line.amount)}${monthly ? ' / month' : ''}`}${line.detail ? ` (${line.detail})` : ''}`).join('; ')
}

type FeeEdit = { name: string; amount: string; refundable: string }

export function LeaseReview({ draft, busy, error, onConfirm, onBack }: Props) {
  const [summary, setSummary] = useState<ReviewSummary>(() => initialReviewSummary(draft))
  const [openEditor, setOpenEditor] = useState<LeaseFieldId | null>(null)
  const [feeEdits, setFeeEdits] = useState<FeeEdit[]>([])
  const [discountEdits, setDiscountEdits] = useState<{ kind: string; month: string; amount: string }[]>([])
  const [utilityAmount, setUtilityAmount] = useState('')
  const [utilityStatus, setUtilityStatus] = useState<'estimated' | 'included_in_rent'>('estimated')
  const [holdingTreatment, setHoldingTreatment] = useState('credited_to_first_month_rent')
  const [localError, setLocalError] = useState<string | null>(null)
  const duplicateUtilities = useMemo(() => likelyUtilityDuplicate(draft), [draft])
  const readiness = validateReviewSummary(draft, summary)
  const updateSummary = (patch: Partial<ReviewSummary>) => setSummary(current => ({ ...current, ...patch, ...(('rentalName' in patch || 'monthlyRent' in patch || 'leaseMonths' in patch) ? { checked: false } : {}) }))
  const setEdit = (field: LeaseFieldId, edit: ReviewEdit) => setSummary(current => ({ ...current, checked: ['rental_label', 'monthly_base_rent', 'lease_term_months', 'lease_break_fee', 'security_deposit', 'holding_deposit', 'holding_deposit_status', 'first_month_rent_due_upfront', 'last_month_rent_due_upfront', 'nonrefundable_fees', 'nonrefundable_fees_status', 'other_charges', 'other_charges_status', 'recurring_charges', 'recurring_charges_status', 'utilities', 'concessions'].includes(field) ? false : current.checked, edits: { ...current.edits, [field]: edit } }))
  const open = (field: LeaseFieldId) => {
    const original = findTerm(draft, field)
    const edit = summary.edits[field]
    const term = edit?.action === 'correct' ? { ...original, value: edit.value } : original
    setOpenEditor(field)
    const sourceEntries = Array.isArray(term?.value) ? term.value : []
    setFeeEdits(chargeLines(term?.value).map((line, index) => ({ name: line.name.startsWith('Unnamed fee') ? '' : line.name, amount: line.amount === null ? '' : String(line.amount), refundable: sourceEntries[index]?.refundable === true ? 'yes' : sourceEntries[index]?.refundable === false ? 'no' : '' })))
    setDiscountEdits(sourceEntries.map(item => ({ kind: item?.kind || 'rent_credit', month: String(item?.month ?? ''), amount: String(item?.amount ?? '') })))
    const utility = term?.value && typeof term.value === 'object' && !Array.isArray(term.value) ? term.value as Record<string, unknown> : null
    setUtilityStatus(utility?.status === 'included_in_rent' ? 'included_in_rent' : 'estimated')
    const utilityValue = utility?.amount ?? utility?.estimated_monthly_amount ?? (typeof term?.value === 'number' ? term.value : undefined)
    setUtilityAmount(typeof utilityValue === 'number' ? String(utilityValue) : typeof term?.value === 'string' ? term.value : '')
    const holding = term?.value && typeof term.value === 'object' && !Array.isArray(term.value) ? term.value as Record<string, unknown> : null
    setHoldingTreatment(typeof holding?.treatment === 'string' ? holding.treatment : 'credited_to_first_month_rent')
  }
  const applyChargeEdit = (field: LeaseFieldId) => {
    try { setEdit(field, { action: 'correct', value: feeEdits.map((fee, index) => {
      const amount = Number(fee.amount)
      if (!fee.name.trim() || !fee.amount.trim() || !Number.isFinite(amount) || amount <= 0) throw new Error(`Enter a name and positive amount for fee ${index + 1}.`)
      if (field === 'other_charges' && !fee.refundable) throw new Error(`Confirm whether ${fee.name} is refundable, or leave it unconfirmed.`)
      return field === 'recurring_charges' ? { name: fee.name.trim(), monthly_amount: amount } : { name: fee.name.trim(), amount, refundable: field === 'other_charges' && fee.refundable === 'yes' }
    }) }); setLocalError(null); setOpenEditor(null) }
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
    if (field === 'concessions') return <div className="mt-3 space-y-2">
      {discountEdits.map((discount, index) => <div key={index} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-3">
        <label className="label">Discount type<select className="field mt-1" value={discount.kind} onChange={event => setDiscountEdits(current => current.map((item, i) => i === index ? { ...item, kind: event.target.value } : item))}><option value="rent_credit">Rent credit</option><option value="free_rent_month">Free rent month</option><option value="promotional_credit">Promotional credit</option></select></label>
        <label className="label">Lease month<input className="field mt-1" type="number" min="1" max={summary.leaseMonths || 120} value={discount.month} onChange={event => setDiscountEdits(current => current.map((item, i) => i === index ? { ...item, month: event.target.value } : item))}/></label>
        {discount.kind !== 'free_rent_month' && <label className="label">Credit amount<input className="field mt-1" type="number" min="0.01" step="0.01" value={discount.amount} onChange={event => setDiscountEdits(current => current.map((item, i) => i === index ? { ...item, amount: event.target.value } : item))}/></label>}
        <button type="button" className="min-h-11 text-sm text-forest underline" onClick={() => setDiscountEdits(current => current.filter((_, i) => i !== index))}>Remove discount</button>
      </div>)}
      <button type="button" className="min-h-11 px-3 text-sm font-bold text-forest underline" onClick={() => setDiscountEdits(current => [...current, { kind: 'rent_credit', month: '', amount: '' }])}>Add a discount</button>
      <button type="button" className="min-h-11 rounded-lg bg-forest px-3 text-sm font-bold text-white" onClick={() => {
        if (discountEdits.some(item => !/^\d+$/.test(item.month) || Number(item.month) < 1 || Number(item.month) > Number(summary.leaseMonths) || item.kind !== 'free_rent_month' && (!item.amount.trim() || !Number.isFinite(Number(item.amount)) || Number(item.amount) <= 0))) { setLocalError('Enter a valid lease month and credit amount.'); return }
        setEdit(field, { action: 'correct', value: discountEdits.map(item => ({ kind: item.kind, month: Number(item.month), ...(item.kind === 'free_rent_month' ? {} : { amount: Number(item.amount) }) })) }); setOpenEditor(null)
      }}>Save discounts</button>
    </div>
    if (chargeFields.has(field)) return <div className="mt-3 space-y-2">
      <p className="text-xs text-muted">Include only fees you are required to pay. Keep uncertain charges unconfirmed.</p>
      {feeEdits.map((fee, index) => <div key={index} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-2">
        <label className="label">Fee name<input aria-label={`Fee name ${index + 1}`} className="field mt-1" value={fee.name} onChange={event => setFeeEdits(current => current.map((item, i) => i === index ? { ...item, name: event.target.value } : item))}/></label>
        <label className="label">{field === 'recurring_charges' ? 'Monthly amount' : 'Amount'}<input aria-label={`Fee amount ${index + 1}`} className="field mt-1" type="number" min="0.01" step="0.01" value={fee.amount} onChange={event => setFeeEdits(current => current.map((item, i) => i === index ? { ...item, amount: event.target.value } : item))}/></label>
        {field === 'other_charges' && <label className="label">Can it be refunded?<select aria-label={`Refund terms for fee ${index + 1}`} className="field mt-1" value={fee.refundable} onChange={event => setFeeEdits(current => current.map((item, i) => i === index ? { ...item, refundable: event.target.value } : item))}><option value="">Not confirmed</option><option value="yes">Refundable</option><option value="no">Nonrefundable</option></select></label>}
        <button type="button" className="min-h-11 text-left text-sm font-bold text-forest underline" aria-label={`Remove ${fee.name || 'unnamed fee'}`} onClick={() => setFeeEdits(current => current.filter((_, i) => i !== index))}>Remove fee</button>
      </div>)}
      <button type="button" className="min-h-11 text-sm font-bold text-forest underline" onClick={() => setFeeEdits(current => [...current, { name: '', amount: '', refundable: '' }])}>Add a fee</button>
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
    const fallback: CandidateTerm = { field_id: field, value: null, status: 'not_found', source_excerpt: null, page_reference: null, uncertainty_note: null, evidence_verification: 'missing', review_state: 'needs_review' }
    const effective = edit?.action === 'correct' ? { ...(term || fallback), status: 'explicit' as const, value: edit.value } : term
    let value = termValue(effective)
    if (chargeFields.has(field)) value = chargeText(effective, field === 'recurring_charges')
    if (edit?.action === 'mark_unknown') value = 'Not confirmed'
    if (edit?.action === 'confirm_none') value = 'Confirmed none'
    const unclear = term?.status === 'ambiguous' || term?.status === 'contradictory'
    const incompatible = effective?.status === 'explicit' && !acceptedShape(field, effective.value) && !edit
    const hiddenOptional = !financialSummaryFields.has(field)
    return <div key={field} className="border-b border-line py-3 last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1"><dt className="text-sm text-muted">{label}</dt><dd className="mt-1 break-words text-sm font-semibold text-ink">{value}</dd>
          {field === 'utilities' && effective?.status === 'explicit' && value !== 'Included in rent' && <p className="mt-1 text-xs text-muted">Estimate only; actual bills can vary.</p>}
          {field === 'security_deposit' && value !== 'Confirmed none' && <p className="mt-1 text-xs text-muted">Refund terms are not separately confirmed. Check the source for conditions; deposits are kept separate from expenses.</p>}
          {unclear && !edit && <p className="mt-1 text-xs font-semibold text-amber-900">{term?.status === 'contradictory' ? 'Conflicting wording' : 'Unclear wording'} — left unconfirmed.</p>}
          {incompatible && <p className="mt-1 text-xs text-amber-900">These details need correction before they can be included in your calculation.</p>}
          {term?.status === 'explicit' && term.evidence_verification !== 'verified_text' && term.evidence_verification !== 'verified_page' && !edit && <p className="mt-1 text-xs text-amber-900">Source not verified — check your lease.</p>}
          {hiddenOptional && !edit && <p className="mt-1 text-xs text-muted">Not included unless you review it here.</p>}
          {safeEvidence(term)}
        </div>
        <button type="button" aria-label={`Edit ${label.toLowerCase()}`} aria-expanded={openEditor === field} className="min-h-11 shrink-0 rounded px-2 text-sm font-bold text-forest underline" onClick={() => beginEdit(field)}>Edit</button>
      </div>
      {hiddenOptional && term?.status === 'explicit' && acceptedShape(field, term.value) && !edit && <button type="button" className="min-h-11 rounded text-sm font-bold text-forest underline" onClick={() => setEdit(field, { action: 'accept' })}>I've checked these details; include them</button>}
      {openEditor === field && <div className="mt-2 rounded-lg border border-line bg-white p-3">{simpleEditor(effective || fallback, field)}<div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="min-h-11 rounded-lg border border-line px-3 text-sm font-semibold" onClick={() => { setEdit(field, { action: 'mark_unknown' }); setOpenEditor(null) }}>Leave unconfirmed</button>
        {field === 'security_deposit' && <button type="button" className="min-h-11 rounded-lg border border-line px-3 text-sm font-semibold" onClick={() => { setEdit(field, { action: 'confirm_none' }); setOpenEditor(null) }}>Confirm no deposit</button>}
        <button type="button" className="min-h-11 rounded-lg px-3 text-sm underline" onClick={() => setOpenEditor(null)}>Cancel edit</button>
      </div></div>}
      {field === 'recurring_charges' && duplicateUtilities.length > 0 && !summary.edits.recurring_charges && <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><strong>Check for a duplicate:</strong> {duplicateUtilities.join(', ')} may also be counted under Utilities. Confirm these are separate costs or remove the repeated fee.<div className="mt-2 flex flex-wrap gap-2"><button type="button" className="min-h-11 rounded-lg border border-amber-700 px-3 text-sm font-semibold" onClick={() => setEdit('recurring_charges', { action: 'accept' })}>These are separate costs</button><button type="button" className="min-h-11 rounded-lg border border-amber-700 px-3 text-sm font-semibold" onClick={() => beginEdit('recurring_charges')}>Edit monthly fees</button></div></div>}
    </div>
  }

  const schedules: [LeaseFieldId, string][] = [['recurring_charges_status', 'monthly fees'], ['nonrefundable_fees_status', 'nonrefundable move-in fees'], ['other_charges_status', 'other move-in charges']]
  const scheduleChecked = (field: LeaseFieldId) => ['confirm_none', 'accept'].includes(summary.edits[field]?.action || '')
  const questions: string[] = []
  if (!scheduleChecked('recurring_charges_status')) questions.push('Are there any other required monthly fees, and what do they cover?')
  if (!scheduleChecked('nonrefundable_fees_status') || !scheduleChecked('other_charges_status')) questions.push('Can I have a complete breakdown of everything due before move-in?')
  if (summary.edits.security_deposit?.action !== 'confirm_none') questions.push('How much is the security deposit, and when and under what conditions is it refunded?')
  if (!summary.edits.early_termination || !summary.edits.lease_break_fee) questions.push('What rent, fees, and notice would I owe if I leave early?')
  const legalFields: LeaseFieldId[] = ['early_termination', 'lease_break_fee', 'notice_requirements', 'renewal_or_rent_change', 'late_payment_fees', 'roommate_liability', 'conditional_concessions']
  const requiredUnclear = !summary.monthlyRent || !summary.leaseMonths

  return <form onSubmit={submit} className="lease-review space-y-4" aria-label="Review lease summary">
    <header><div className="kicker">Review your lease</div><h2 className="mt-1 font-display text-2xl">Here's what we found in your lease.</h2><p className="mt-2 text-sm text-muted">Check the costs below. Open a source or edit anything that needs correcting. Missing details stay unconfirmed.</p></header>
    <section className="surface p-4 sm:p-5" aria-label="Essential rental details">
      <h3 className="font-display text-xl">{summary.rentalName || 'Your rental'}</h3>
      <dl className="mt-3 grid grid-cols-2 gap-4">
        <div><dt className="text-sm text-muted">Monthly base rent</dt><dd className="mt-1 text-2xl font-bold text-ink">{summary.monthlyRent ? money(Number(summary.monthlyRent)) : 'Not confirmed'}</dd>{safeEvidence(findTerm(draft, 'monthly_base_rent'))}</div>
        <div><dt className="text-sm text-muted">Lease length</dt><dd className="mt-1 text-2xl font-bold text-ink">{summary.leaseMonths ? `${summary.leaseMonths} months` : 'Not confirmed'}</dd>{safeEvidence(findTerm(draft, 'lease_term_months'))}</div>
      </dl>
      {(['monthly_base_rent', 'lease_term_months'] as LeaseFieldId[]).some(field => ['ambiguous', 'contradictory'].includes(findTerm(draft, field)?.status || '')) && <p className="mt-2 text-sm text-amber-900">Rent or lease length is unclear. Enter the correct details before continuing.</p>}
      <details className="mt-2" open={requiredUnclear || undefined}><summary className="w-fit cursor-pointer rounded py-2 text-sm font-bold text-forest underline">Edit rental details</summary><div className="mt-2 grid gap-3 sm:grid-cols-3">
        <label className="label">Rental name<input className="field mt-1" value={summary.rentalName} onChange={event => updateSummary({ rentalName: event.target.value })} maxLength={120}/></label>
        <label className="label">Monthly rent<input className="field mt-1" type="number" min="0.01" step="0.01" value={summary.monthlyRent} onChange={event => updateSummary({ monthlyRent: event.target.value })}/></label>
        <label className="label">Lease duration in months<input className="field mt-1" type="number" min="1" max="120" step="1" value={summary.leaseMonths} onChange={event => updateSummary({ leaseMonths: event.target.value })}/></label>
      </div>{safeEvidence(findTerm(draft, 'rental_label'))}</details>
    </section>
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <section className="surface p-4 sm:p-5" aria-label="Monthly costs"><h3 className="font-display text-xl">Alongside your rent</h3><dl>{editableFinancial('recurring_charges', 'Monthly fees identified')}{editableFinancial('utilities', 'Utilities')}</dl></section>
      <section className="surface p-4 sm:p-5" aria-label="Move-in costs"><h3 className="font-display text-xl">Before you move in</h3><dl>
        {editableFinancial('security_deposit', 'Security deposit')}
        {editableFinancial('nonrefundable_fees', 'Nonrefundable fees identified')}
        {(findTerm(draft, 'other_charges')?.status === 'explicit' || summary.edits.other_charges) && editableFinancial('other_charges', 'Other move-in charges')}
        {editableFinancial('first_month_rent_due_upfront', "First month's rent upfront")}
        {editableFinancial('last_month_rent_due_upfront', "Last month's rent upfront")}
      </dl><p className="mt-2 text-xs text-muted">Prepaid rent pays for a lease month; it is not an extra fee. We don't add a preliminary upfront total here while charges may be incomplete.</p></section>
    </div>
    <section className="rounded-xl border border-amber-200 bg-amber-50 p-4" aria-label="Questions worth asking"><h3 className="font-display text-xl">Questions worth asking</h3><p className="mt-1 text-sm text-muted">Not found does not mean it does not apply.</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink">{questions.map(question => <li key={question}>{question}</li>)}</ul>
      <details className="mt-3"><summary className="cursor-pointer rounded py-2 text-sm font-semibold text-forest">I've checked whether other fees apply</summary><p className="mt-1 text-xs text-muted">Only confirm a category after checking the complete lease and required fees. This does not remove the amounts above.</p>{schedules.map(([field, label]) => <label key={field} className="flex min-h-11 items-center gap-3 py-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-forest" checked={scheduleChecked(field)} onChange={event => setEdit(field, { action: event.target.checked ? 'confirm_none' : 'mark_unknown' })}/><span>I've checked all {label}.</span></label>)}</details>
    </section>
    <details className="surface p-4 sm:p-5"><summary className="cursor-pointer rounded py-2 font-display text-xl">Other payments and discounts</summary><p className="mt-1 text-sm text-muted">Optional details stay unconfirmed unless you choose to include or correct them.</p><dl>{editableFinancial('holding_deposit', 'Holding deposit')}{editableFinancial('concessions', 'Discounts or rent credits')}{findTerm(draft, 'other_charges')?.status !== 'explicit' && !summary.edits.other_charges && editableFinancial('other_charges', 'Other move-in charges')}</dl></details>
    <details className="surface p-4 sm:p-5" aria-label="Lease conditions"><summary className="cursor-pointer rounded py-2 font-display text-xl">Lease conditions and other unknowns</summary><p className="mt-1 text-sm text-muted">These terms are not approved by the cost summary. Read their source and decide whether to include them.</p>
      <div className="divide-y divide-line">{legalFields.map(field => {
        const term = findTerm(draft, field)
        const edit = summary.edits[field]
        const shown = edit?.action === 'mark_unknown' ? 'Not confirmed' : edit?.action === 'confirm_none' ? 'You confirmed this does not apply' : edit?.action === 'correct' ? formatCandidateValue(edit.value) : term?.status === 'explicit' ? `${termValue(term)}${edit?.action === 'accept' ? ' — reviewed by you' : ' — not confirmed'}` : earlyMessages[field]
        return <section key={field} className="py-3"><h4 className="text-sm font-bold">{labels[field]}</h4><p className="mt-1 break-words text-sm text-muted">{shown}</p>{term && ['ambiguous', 'contradictory'].includes(term.status) && <p className="text-xs text-amber-900">Unclear or conflicting wording — check the source.</p>}{safeEvidence(term)}
          <div className="mt-2 flex flex-wrap gap-2">{term?.status === 'explicit' && <button type="button" className="min-h-11 rounded-lg border border-line px-3 text-xs font-bold text-forest" onClick={() => setEdit(field, { action: 'accept' })}>I've read and checked this clause</button>}<button type="button" aria-label={`Edit ${labels[field]?.toLowerCase()}`} className="min-h-11 rounded px-3 text-xs font-bold text-forest underline" onClick={() => beginEdit(field)}>Edit</button><button type="button" className="min-h-11 rounded px-3 text-xs underline" onClick={() => { setEdit(field, { action: 'mark_unknown' }); setOpenEditor(null) }}>Leave unconfirmed</button></div>
          {openEditor === field && simpleEditor(term || { field_id: field, value: null, status: 'not_found', source_excerpt: null, page_reference: null, uncertainty_note: null, evidence_verification: 'missing', review_state: 'needs_review' }, field)}
        </section>
      })}</div>
      {draft.general_warnings.length > 0 && <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm"><strong>Additional notes from extraction</strong><ul className="mt-2 list-disc pl-5">{draft.general_warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
    </details>
    <section className="rounded-xl border-2 border-forest bg-[#f4faf6] p-4"><label className="flex cursor-pointer items-start gap-3 text-sm font-semibold text-ink"><input className="mt-1 h-5 w-5 accent-forest" type="checkbox" checked={summary.checked} onChange={event => updateSummary({ checked: event.target.checked })}/><span>I've checked the rent, lease length, and costs shown.</span></label><p className="mt-2 text-xs text-muted">Unconfirmed details stay unknown. Other payments and clauses need their own review.</p><p role="status" className="mt-2 text-sm text-forest">{readiness || 'Ready to calculate known costs.'}</p></section>
    {(localError || error) && <p role="alert" className="text-sm text-red-800">{localError || error}</p>}
    <div className="flex flex-wrap gap-3"><button type="button" className="min-h-11 rounded-xl border border-line px-5 py-2 text-sm font-bold" onClick={onBack}>Back to my lease</button><button type="submit" disabled={busy || Boolean(readiness)} className="min-h-11 rounded-xl bg-forest px-5 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Confirming lease…' : 'See my rental costs'}</button></div>
  </form>
}
