import { describe, expect, it } from 'vitest'
import { buildReviewDecisions, formatCandidateValue, initialReviewSummary, likelyUtilityDuplicate, validateReviewSummary } from '../lib/leaseReview'
import type { CandidateTerm, LeaseDraft, LeaseFieldId } from '../types/rental'

const term = (field_id: LeaseFieldId, value: unknown, status: CandidateTerm['status'] = 'explicit', evidence: CandidateTerm['evidence_verification'] = 'verified_text'): CandidateTerm => ({
  field_id, value: status === 'explicit' ? value : null, status, source_excerpt: status === 'explicit' ? `${field_id} appears in the lease.` : null,
  page_reference: null, uncertainty_note: status === 'explicit' ? null : 'The lease did not clearly say.', evidence_verification: evidence, review_state: 'needs_review',
})
const makeDraft = (terms: CandidateTerm[]): LeaseDraft => ({ draft_id: 'original-draft-id', terms, general_warnings: [], review_required: true, source_type: 'pasted_text' })
const ready = (draft: LeaseDraft) => ({ ...initialReviewSummary(draft), rentalName: 'My place', monthlyRent: '1600', leaseMonths: '12', checked: true })

describe('simplified lease review decision adapter', () => {
  it('builds exactly one decision per draft term and never accepts a hidden clause by bulk confirmation', () => {
    const draft = makeDraft([term('rental_label', 'Downtown home'), term('monthly_base_rent', 1600), term('lease_term_months', 12), term('early_termination', 'Tenant may terminate with written notice.'), term('lease_break_fee', null, 'not_found')])
    const decisions = buildReviewDecisions(draft, { ...ready(draft), rentalName: 'Downtown home' })
    expect(decisions).toHaveLength(draft.terms.length)
    expect(decisions.map(item => item.field_id)).toEqual(draft.terms.map(item => item.field_id))
    expect(decisions.find(item => item.field_id === 'early_termination')).toEqual({ field_id: 'early_termination', action: 'mark_unknown' })
    expect(decisions.find(item => item.field_id === 'lease_break_fee')).toEqual({ field_id: 'lease_break_fee', action: 'mark_unknown' })
  })

  it('accepts clearly shown core facts only after explicit summary confirmation', () => {
    const draft = makeDraft([term('rental_label', 'Downtown home'), term('monthly_base_rent', 1600), term('lease_term_months', 12)])
    const state = { ...ready(draft), rentalName: 'Downtown home' }
    expect(validateReviewSummary(draft, { ...state, checked: false })).toMatch(/check/i)
    expect(buildReviewDecisions(draft, state)).toEqual([
      { field_id: 'rental_label', action: 'accept' },
      { field_id: 'monthly_base_rent', action: 'accept' },
      { field_id: 'lease_term_months', action: 'accept' },
    ])
  })

  it('uses corrections for changed values and manually supplied required terms', () => {
    const draft = makeDraft([term('monthly_base_rent', 1500), term('lease_term_months', 12)])
    const decisions = buildReviewDecisions(draft, { ...ready(draft), rentalName: 'New name' })
    expect(decisions).toEqual([
      { field_id: 'monthly_base_rent', action: 'correct', value: 1600 },
      { field_id: 'lease_term_months', action: 'accept' },
      { field_id: 'rental_label', action: 'correct', value: 'New name' },
    ])
  })

  it('keeps all optional fields missing from the draft unknown by default', () => {
    const draft = makeDraft([term('rental_label', 'Place'), term('monthly_base_rent', 1600), term('lease_term_months', 12), term('security_deposit', null, 'not_found')])
    const decisions = buildReviewDecisions(draft, { ...ready(draft), rentalName: 'Place' })
    expect(decisions).toHaveLength(4)
    expect(decisions.find(item => item.field_id === 'security_deposit')).toEqual({ field_id: 'security_deposit', action: 'mark_unknown' })
    expect(decisions.some(item => item.action === 'confirm_none')).toBe(false)
  })

  it('uses confirm_none only after a direct no-charge action and completes the fee-list status', () => {
    const draft = makeDraft([term('rental_label', 'Place'), term('monthly_base_rent', 1600), term('lease_term_months', 12), term('nonrefundable_fees', null, 'not_found')])
    const state = { ...ready(draft), rentalName: 'Place', edits: { nonrefundable_fees: { action: 'confirm_none' as const }, nonrefundable_fees_status: { action: 'confirm_none' as const } } }
    const decisions = buildReviewDecisions(draft, state)
    expect(decisions).toContainEqual({ field_id: 'nonrefundable_fees', action: 'confirm_none' })
    expect(decisions).toContainEqual({ field_id: 'nonrefundable_fees_status', action: 'confirm_none' })
  })

  it('does not accept ambiguous essential facts, even after summary confirmation', () => {
    const draft = makeDraft([term('rental_label', 'Place'), term('monthly_base_rent', null, 'ambiguous'), term('lease_term_months', 12)])
    expect(initialReviewSummary(draft).monthlyRent).toBe('')
    const state = { ...ready(draft), rentalName: 'Place' }
    expect(buildReviewDecisions(draft, state).find(item => item.field_id === 'monthly_base_rent')).toEqual({ field_id: 'monthly_base_rent', action: 'correct', value: 1600 })
  })

  it('detects possible duplicated utility classification and requires a user choice', () => {
    const draft = makeDraft([
      term('rental_label', 'Place'), term('monthly_base_rent', 1600), term('lease_term_months', 12),
      term('utilities', { status: 'estimated', amount: 130 }),
      term('recurring_charges', [{ name: 'Utilities', amount: 130, frequency: 'monthly' }, { name: 'Internet', amount: 40, frequency: 'monthly' }]),
    ])
    expect(likelyUtilityDuplicate(draft)).toEqual(['Utilities'])
    expect(validateReviewSummary(draft, { ...ready(draft), rentalName: 'Place' })).toMatch(/whether utilities are already included/i)
    expect(() => buildReviewDecisions(draft, { ...ready(draft), rentalName: 'Place', edits: { recurring_charges: { action: 'correct', value: [{ name: 'Utilities', monthly_amount: 130 }, { name: 'Internet', monthly_amount: 40 }] } } })).toThrow(/still includes a possible utilities duplicate/i)
    const clarified = { ...ready(draft), rentalName: 'Place', edits: { recurring_charges: { action: 'correct' as const, value: [{ name: 'Internet', monthly_amount: 40 }] } } }
    expect(buildReviewDecisions(draft, clarified).find(item => item.field_id === 'recurring_charges')).toEqual({ field_id: 'recurring_charges', action: 'correct', value: [{ name: 'Internet', monthly_amount: 40 }] })
  })

  it('does not mutate the original extraction draft when creating decisions', () => {
    const draft = makeDraft([term('rental_label', 'Place'), term('monthly_base_rent', 1600), term('lease_term_months', 12), term('recurring_charges', [{ name: 'Internet', amount: 40, frequency: 'monthly' }])])
    const snapshot = JSON.stringify(draft)
    const decisions = buildReviewDecisions(draft, { ...ready(draft), rentalName: 'Place', edits: { recurring_charges: { action: 'correct', value: [{ name: 'Internet', monthly_amount: 50 }] } } })
    expect(decisions.find(item => item.field_id === 'recurring_charges')).toEqual({ field_id: 'recurring_charges', action: 'correct', value: [{ name: 'Internet', monthly_amount: 50 }] })
    expect(JSON.stringify(draft)).toBe(snapshot)
  })

  it('renders structured Gemini candidates as readable terms instead of JSON', () => {
    expect(formatCandidateValue([{ name: 'Internet', amount: 40, frequency: 'monthly' }, { name: 'Parking', monthly_amount: 125 }])).toBe('Internet — $40 / month; Parking — $125')
    expect(formatCandidateValue({ status: 'estimated', amount: 130, source_description: 'Tenant pays water' })).toContain('Tenant pays water')
    expect(formatCandidateValue([{ fee_description: 'Internet access', fee_amount: 40, billing_frequency: 'monthly' }])).toBe('Internet access — $40 / month')
  })

  it('does not bulk-accept provider-specific fee shapes that the confirmation contract cannot normalize', () => {
    const draft = makeDraft([term('rental_label', 'Place'), term('monthly_base_rent', 1600), term('lease_term_months', 12), term('recurring_charges', [{ fee_description: 'Internet access', fee_amount: 40, billing_frequency: 'monthly' }])])
    const decision = buildReviewDecisions(draft, { ...ready(draft), rentalName: 'Place' }).find(item => item.field_id === 'recurring_charges')
    expect(decision).toEqual({ field_id: 'recurring_charges', action: 'mark_unknown' })
  })
})
