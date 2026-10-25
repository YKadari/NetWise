export type MoneyStatus = 'provided' | 'none' | 'unknown'
export type TermProvenance = { source_type?: 'user_entered' | 'document_extracted'; source_reference?: string | null; review_state?: 'needs_review' | 'confirmed' | 'corrected'; reviewed_by_user?: boolean }
export type MoneyTerm = { status: MoneyStatus; amount?: number; provenance?: TermProvenance }
export type RecurringCharge = { name: string; monthly_amount: number }
export type OneTimeCharge = { name: string; amount: number; refundable?: boolean }
export type Concession = { kind: 'free_rent_month' | 'rent_credit' | 'promotional_credit'; month: number; amount?: number; eligible_category?: 'base_rent' | 'recurring_charge' | 'utilities'; eligible_charge_name?: string }

export interface RentalOffer {
  rental_label: string
  monthly_base_rent: number
  lease_term_months: number
  expected_roommate_contribution?: MoneyTerm
  recurring_charges?: RecurringCharge[]
  recurring_charges_status?: 'complete' | 'unknown'
  utilities?: { status: 'included_in_rent' | 'estimated' | 'unknown'; estimated_monthly_amount?: number }
  upfront?: {
    security_deposit?: MoneyTerm
    first_month_rent_due_upfront?: 'yes' | 'no' | 'unknown'
    last_month_rent_due_upfront?: 'yes' | 'no' | 'unknown'
    nonrefundable_fees?: OneTimeCharge[]
    nonrefundable_fees_status?: 'complete' | 'unknown'
    other_charges?: OneTimeCharge[]
    other_charges_status?: 'complete' | 'unknown'
    holding_deposit_status?: 'provided' | 'none' | 'unknown'
    holding_deposit?: { amount: number; treatment: string }
  }
  concessions?: Concession[]
}

export interface FinancialProfile {
  monthly_take_home_income: number
  available_savings: number
  essential_monthly_nonhousing_expenses: number
  student_loan_payment?: number
  student_loan_included_in_essential_expenses: boolean
  monthly_savings_target?: number
  expected_roommate_contribution?: number
  minimum_emergency_cash_reserve?: number
}

export interface RentalMonth {
  month: number
  calendar_month: string | null
  base_rent_after_concessions: number
  recurring_charges_after_concessions: number
  estimated_utilities_after_concessions: number
  gross_contractual_housing_expense: number
  modeled_renter_housing_share: number | null
  rent_prepayment_allocated: number
  rent_cash_due_this_month: number | null
  monthly_nonrent_cash_due: number | null
  cash_remaining_after_expenses_and_savings?: number | null
  cash_remaining_from_monthly_income_after_scheduled_payments: number | null
}

export interface RentalEvaluation {
  rental_label: string
  lease: { term_months: number }
  monthly_costs: { base_rent_before_concessions: number; gross_known_monthly_housing_obligation: number; average_modeled_housing_obligation: number; recurring_charges_known_subtotal: number; utilities_known_subtotal: number; monthly_costs_complete: boolean; expected_personal_monthly_share: number }
  upfront: { upfront_cash_required: number; upfront_cash_complete: boolean; refundable_cash_held: number; potential_deposit_refund_not_guaranteed: number; unknown_upfront_terms: string[] }
  lease_totals: { known_modeled_nonrefundable_lease_cost: number; nonrefundable_cost_complete: boolean; known_total_cash_outflows_including_refundable_holds: number; cash_outflow_total_complete: boolean }
  financial_profile: { known_monthly_cash_remaining_after_housing_and_savings: number; initial_savings_remaining_after_known_move_in_cash: number; affordability_status: string; emergency_reserve_preserved: boolean | null } | null
  month_by_month_cash_flow: RentalMonth[]
  unknown_cost_categories: string[]
  warnings: { code: string; message: string }[]
  assumptions: string[]
}

export interface RentalDecisionBrief {
  source: 'gemini'
  headline: string
  overall_summary: string
  important_findings: string[]
  key_uncertainties: string[]
  suggested_next_step: string
  fact_ids: string[]
    follow_ups: RentalFollowUp[]
    additional_follow_ups: RentalFollowUp[]
}

  export interface RentalFollowUp {
    title: string
    why_it_matters: string
    question: string
    priority: string
    facts: string
  }

  export interface RentalFollowUpResponse {
    source: 'deterministic'
    follow_ups: RentalFollowUp[]
    additional_follow_ups: RentalFollowUp[]
  }

export interface RentalComparison {
  left: RentalEvaluation
  right: RentalEvaluation
  differences: { left_minus_right: Record<string, number | null>; lease_terms_differ: boolean; total_period_costs_directly_comparable: boolean; unknown_cost_categories: { left: string[]; right: string[] } }
  comparison_notes: string[]
  method: string
}

export type LeaseFieldId = 'rental_label' | 'monthly_base_rent' | 'lease_term_months' | 'lease_start_date' | 'occupants' | 'recurring_charges' | 'recurring_charges_status' | 'utilities' | 'security_deposit' | 'first_month_rent_due_upfront' | 'last_month_rent_due_upfront' | 'nonrefundable_fees' | 'nonrefundable_fees_status' | 'other_charges' | 'other_charges_status' | 'holding_deposit' | 'holding_deposit_status' | 'concessions' | 'early_termination' | 'lease_break_fee' | 'notice_requirements' | 'renewal_or_rent_change' | 'late_payment_fees' | 'roommate_liability' | 'conditional_concessions'
export interface CandidateTerm { field_id: LeaseFieldId; value: unknown; source_excerpt: string | null; page_reference: number | null; status: 'explicit' | 'not_found' | 'ambiguous' | 'contradictory'; uncertainty_note: string | null; evidence_verification: 'verified_text' | 'verified_page' | 'unverified' | 'missing'; review_state: 'needs_review' }
export interface LeaseDraft { draft_id: string; terms: CandidateTerm[]; general_warnings: string[]; review_required: true; source_type: 'pasted_text' | 'pdf' }
export interface ReviewDecision { field_id: LeaseFieldId; action: 'accept' | 'correct' | 'mark_unknown' | 'confirm_none'; value?: unknown }
export interface LeaseConfirmation { confirmed_offer: RentalOffer; review_history: unknown[]; confirmed_clauses: Record<string, unknown> }
export interface LeaseServiceStatus { configured: boolean; model: string; service_ready: boolean }

export type StressScenario =
  | { type: 'utility_increase'; additional_monthly_amount: number; first_affected_month: number; last_affected_month: number }
  | { type: 'roommate_contribution_loss'; monthly_contribution_lost: number; first_affected_month: number; last_affected_month: number }
  | { type: 'early_departure'; departure_month: number; treatment: 'known_contractual_termination' | 'hypothetical_settlement' | 'continuing_lease_obligations' | 'unknown_consequences'; termination_fee?: number; termination_fee_source?: string; termination_fee_provenance?: TermProvenance; assumption_note?: string; remaining_rent_treatment?: 'unknown' | 'specified' | 'none_confirmed'; continuing_rent_monthly_amount?: number; continuing_rent_months?: number; deposit_treatment?: 'unknown' | 'withheld' | 'refunded'; deposit_treatment_note?: string; prepaid_rent_treatment?: 'unknown' | 'retained' | 'refunded' }

export interface StressResult {
  scenario_type: StressScenario['type']
  assumptions: Record<string, unknown>
  affected_months: number[]
  baseline: RentalEvaluation
  stressed: { month_by_month: Record<string, number | string | boolean | null>[]; financial_resilience: Record<string, unknown>; known_departure_cash_impact?: number; specified_remaining_rent?: number; prepaid_rent_credit_applied?: number | null; continuing_rent_cash_due_after_prepaid_credit?: number; termination_fee?: number }
  summary: Record<string, unknown>
  warnings: { code: string; message: string }[]
  explanation: string
  result_is_hypothetical_not_a_forecast: boolean
  interpretation: StressInterpretation
}

export interface StressInterpretation {
  source: 'deterministic'
  headline: string
  what_changed: string
  main_consequence: string
  why_it_matters: string
  what_to_watch: string
  what_to_consider: string
}

export interface StressAiInterpretation extends Omit<StressInterpretation, 'source'> {
  source: 'gemini'
  statement_ids: string[]
}
