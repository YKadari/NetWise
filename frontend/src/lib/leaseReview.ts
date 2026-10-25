import type { CandidateTerm, LeaseDraft, LeaseFieldId, ReviewDecision } from '../types/rental'

export type ReviewEdit = { action: 'accept' | 'correct' | 'mark_unknown' | 'confirm_none'; value?: unknown }
export type ReviewEdits = Partial<Record<LeaseFieldId, ReviewEdit>>
export interface ReviewSummary {
  rentalName: string
  monthlyRent: string
  leaseMonths: string
  checked: boolean
  edits: ReviewEdits
}

export const requiredLeaseFields: LeaseFieldId[] = ['rental_label', 'monthly_base_rent', 'lease_term_months']
export const financialSummaryFields = new Set<LeaseFieldId>([
  'security_deposit', 'holding_deposit', 'holding_deposit_status', 'first_month_rent_due_upfront',
  'last_month_rent_due_upfront', 'nonrefundable_fees', 'nonrefundable_fees_status', 'other_charges',
  'other_charges_status', 'recurring_charges', 'recurring_charges_status', 'utilities', 'concessions',
])
export const clauseFields = new Set<LeaseFieldId>([
  'early_termination', 'lease_break_fee', 'notice_requirements', 'renewal_or_rent_change',
  'late_payment_fees', 'roommate_liability', 'conditional_concessions',
])

export function findTerm(draft: LeaseDraft, field: LeaseFieldId): CandidateTerm | undefined {
  return draft.terms.find(term => term.field_id === field)
}

function candidateInitial(term: CandidateTerm | undefined, fallback = ''): string {
  return term?.status === 'explicit' && (typeof term.value === 'string' || typeof term.value === 'number')
    ? String(term.value)
    : fallback
}

export function initialReviewSummary(draft: LeaseDraft): ReviewSummary {
  return {
    rentalName: candidateInitial(findTerm(draft, 'rental_label'), 'My rental'),
    monthlyRent: candidateInitial(findTerm(draft, 'monthly_base_rent')),
    leaseMonths: candidateInitial(findTerm(draft, 'lease_term_months')),
    checked: false,
    edits: {},
  }
}

export function likelyUtilityDuplicate(draft: LeaseDraft): string[] {
  const utility = findTerm(draft, 'utilities')
  const recurring = findTerm(draft, 'recurring_charges')
  if (utility?.status !== 'explicit' || recurring?.status !== 'explicit' || !Array.isArray(recurring.value)) return []
  const matches: string[] = []
  for (const charge of recurring.value) {
    if (!charge || typeof charge !== 'object') continue
    const item = charge as Record<string, unknown>
    const name = [item.name, item.fee_description, item.description, item.charge_name].find(value => typeof value === 'string') as string | undefined || ''
    const nameLooksLikeUtilities = /(^|[\s_-])(utilities?|water|electric(?:ity)?|gas)(?=$|[\s_-])/i.test(name.trim())
    if (nameLooksLikeUtilities) matches.push(name || 'This charge')
  }
  return matches
}

function acceptedShape(field: LeaseFieldId, value: unknown): boolean {
  if (field === 'security_deposit') return typeof value === 'number' && Number.isFinite(value) && value >= 0
  if (field === 'recurring_charges') return Array.isArray(value) && value.every(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
    const item = entry as Record<string, unknown>
    return typeof item.name === 'string' && (typeof item.monthly_amount === 'number' && Number.isFinite(item.monthly_amount) && item.monthly_amount > 0 || item.frequency === 'monthly' && typeof item.amount === 'number' && Number.isFinite(item.amount) && item.amount > 0)
  })
  if (field === 'nonrefundable_fees' || field === 'other_charges') return Array.isArray(value) && value.every(entry => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry) && typeof (entry as Record<string, unknown>).name === 'string' && typeof (entry as Record<string, unknown>).amount === 'number' && Number.isFinite((entry as Record<string, unknown>).amount) && (entry as Record<string, unknown>).amount as number > 0))
  if (field === 'utilities') {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const item = value as Record<string, unknown>
      return item.status === 'included_in_rent' || item.status === 'estimated' && typeof (item.amount ?? item.estimated_monthly_amount) === 'number' && Number.isFinite(Number(item.amount ?? item.estimated_monthly_amount))
    }
    return Array.isArray(value) && value.length === 1 && Boolean(value[0] && typeof value[0] === 'object' && (value[0] as Record<string, unknown>).frequency === 'monthly' && typeof (value[0] as Record<string, unknown>).amount === 'number')
  }
  if (field === 'holding_deposit') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const item = value as Record<string, unknown>
    return typeof item.amount === 'number' && item.amount > 0 && ['credited_to_security_deposit', 'credited_to_first_month_rent', 'credited_to_last_month_rent', 'credited_to_nonrefundable_fees', 'not_credited_refundable', 'not_credited_nonrefundable'].includes(String(item.treatment))
  }
  if (field === 'holding_deposit_status') return false
  if (field === 'recurring_charges_status' || field === 'nonrefundable_fees_status' || field === 'other_charges_status') return value === 'complete'
  if (field === 'concessions') return Array.isArray(value) && value.every(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
    const item = entry as Record<string, unknown>
    return ['free_rent_month', 'rent_credit', 'promotional_credit'].includes(String(item.kind)) && typeof item.month === 'number' && Number.isInteger(item.month) && item.month > 0 && (item.amount === undefined || typeof item.amount === 'number' && Number.isFinite(item.amount) && item.amount >= 0)
  })
  if (field === 'first_month_rent_due_upfront' || field === 'last_month_rent_due_upfront') return typeof value === 'boolean' || value === 'yes' || value === 'no'
  return value !== null && value !== undefined
}

function validRent(raw: string): number | null {
  if (!raw.trim()) return null
  const parsed = Number(raw.replace(/[$,\s]/g, ''))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function validMonths(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) return null
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 120 ? parsed : null
}

export function buildReviewDecisions(draft: LeaseDraft, state: ReviewSummary): ReviewDecision[] {
  const byId = new Map(draft.terms.map(term => [term.field_id, term]))
  const ids = [...draft.terms.map(term => term.field_id)]
  for (const field of requiredLeaseFields) if (!byId.has(field)) ids.push(field)
  for (const field of Object.keys(state.edits) as LeaseFieldId[]) if (!ids.includes(field)) ids.push(field)
  const rent = validRent(state.monthlyRent)
  const months = validMonths(state.leaseMonths)
  const name = state.rentalName.trim()
  if (!name) throw new Error('Give this rental a short name so you can recognize it.')
  if (rent === null) throw new Error('Enter the monthly rent before we calculate the costs.')
  if (months === null) throw new Error('Enter a lease duration from 1 to 120 months.')
  if (!state.checked) throw new Error('Check the displayed rental details in your lease before continuing.')
  if (likelyUtilityDuplicate(draft).length) {
    const recurringEdit = state.edits.recurring_charges
    if (!recurringEdit) throw new Error('Check whether utilities are already included in the monthly fee list before continuing.')
    if (recurringEdit.action === 'correct') {
      const correctedDraft = { ...draft, terms: draft.terms.map(term => term.field_id === 'recurring_charges' ? { ...term, value: recurringEdit.value, status: 'explicit' as const } : term) }
      if (likelyUtilityDuplicate(correctedDraft).length) throw new Error('The fee list still includes a possible utilities duplicate. Remove it or confirm the two costs are separate.')
    }
  }

  const decisions: ReviewDecision[] = []
  for (const field of ids) {
    const term = byId.get(field)
    const edit = state.edits[field]
    if (edit) {
      decisions.push({ field_id: field, action: edit.action, ...(['correct'].includes(edit.action) ? { value: edit.value } : {}) })
      continue
    }

    if (field === 'rental_label') {
      const unchanged = term?.status === 'explicit' && term.value === name
      decisions.push(unchanged ? { field_id: field, action: 'accept' } : { field_id: field, action: 'correct', value: name })
      continue
    }
    if (field === 'monthly_base_rent') {
      const unchanged = term?.status === 'explicit' && term.value === rent
      decisions.push(unchanged ? { field_id: field, action: 'accept' } : { field_id: field, action: 'correct', value: rent })
      continue
    }
    if (field === 'lease_term_months') {
      const unchanged = term?.status === 'explicit' && term.value === months
      decisions.push(unchanged ? { field_id: field, action: 'accept' } : { field_id: field, action: 'correct', value: months })
      continue
    }

    if (term && financialSummaryFields.has(field) && term.status === 'explicit' && acceptedShape(field, term.value)) {
      decisions.push({ field_id: field, action: 'accept' })
      continue
    }

    // Legal clauses and non-summary fields are deliberately never bulk-accepted.
    // Missing/ambiguous terms stay unknown unless a person takes an explicit action.
    decisions.push({ field_id: field, action: 'mark_unknown' })
  }
  return decisions
}

export function validateReviewSummary(draft: LeaseDraft, state: ReviewSummary): string | null {
  try { buildReviewDecisions(draft, state); return null }
  catch (error) { return error instanceof Error ? error.message : 'Check the rental details before continuing.' }
}

export function chargeLines(value: unknown): { name: string; amount: number | null; detail: string | null }[] {
  if (!Array.isArray(value)) return []
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return { name: `Charge ${index + 1}`, amount: null, detail: 'Details need review' }
    const item = entry as Record<string, unknown>
    const rawName = [item.name, item.fee_description, item.description, item.charge_name, item.item].find(entry => typeof entry === 'string' && entry.trim())
    const name = typeof rawName === 'string' ? rawName.trim() : `Charge ${index + 1}`
    const rawAmount = [item.monthly_amount, item.amount, item.fee_amount, item.estimated_monthly_amount, item.monthly_fee].find(entry => typeof entry === 'number' && Number.isFinite(entry))
    const amount = typeof rawAmount === 'number' ? rawAmount : null
    const frequency = [item.frequency, item.billing_frequency, item.payment_frequency].find(entry => typeof entry === 'string')
    const details = [typeof frequency === 'string' ? frequency.replace(/_/g, ' ') : null, typeof item.refundable === 'boolean' ? (item.refundable ? 'refundable' : 'nonrefundable') : null, typeof item.treatment === 'string' ? item.treatment.replace(/_/g, ' ') : null].filter(Boolean)
    return { name, amount, detail: details.length ? details.join(' · ') : null }
  })
}

export function formatCandidateValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Not confirmed'
  if (typeof value === 'number') return Number.isFinite(value) ? `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : 'Not confirmed'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string') {
    const phrase: Record<string, string> = { unknown: 'Not confirmed', none: 'Confirmed none', included_in_rent: 'Included in rent', complete: 'Fee list confirmed complete' }
    return phrase[value] || value.replace(/_/g, ' ')
  }
  if (Array.isArray(value)) {
    if (!value.length) return 'No charges listed'
    return value.map(item => {
      if (!item || typeof item !== 'object') return String(item)
      const record = item as Record<string, unknown>
      const rawName = [record.name, record.fee_description, record.description, record.charge_name, record.item].find(entry => typeof entry === 'string')
      const name = typeof rawName === 'string' ? rawName : 'Charge'
      const rawAmount = [record.monthly_amount, record.amount, record.fee_amount, record.estimated_monthly_amount, record.monthly_fee].find(entry => typeof entry === 'number' && Number.isFinite(entry))
      const amount = typeof rawAmount === 'number' ? rawAmount : null
      const frequency = record.frequency ?? record.billing_frequency ?? record.payment_frequency
      return `${name}${amount === null ? '' : ` — $${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`}${frequency === 'monthly' ? ' / month' : ''}`
    }).join('; ')
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (record.status === 'unknown') return 'Not confirmed'
    if (record.status === 'none') return 'Confirmed none'
    if (record.status === 'included_in_rent') return 'Included in rent'
    const amount = typeof record.amount === 'number' ? record.amount : typeof record.estimated_monthly_amount === 'number' ? record.estimated_monthly_amount : null
    const name = typeof record.name === 'string' ? record.name : null
    const status = typeof record.status === 'string' ? record.status.replace(/_/g, ' ') : null
    const remainder = Object.entries(record).filter(([key]) => !['amount', 'estimated_monthly_amount', 'name', 'status', 'frequency'].includes(key))
      .map(([key, val]) => `${key.replace(/_/g, ' ')}: ${typeof val === 'string' || typeof val === 'number' ? val : 'details provided'}`).join('; ')
    return [name, amount === null ? null : `$${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}${record.frequency === 'monthly' ? ' / month' : ''}`, status, remainder].filter(Boolean).join(' — ') || 'Details need review'
  }
  return 'Details need review'
}
