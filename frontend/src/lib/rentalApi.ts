import { ApiError } from './api'
import type { ClauseExplanation, FinancialProfile, LeaseConfirmation, LeaseDraft, LeaseServiceStatus, RentalComparison, RentalComparisonExplanation, RentalDecisionBrief, RentalEvaluation, RentalFollowUpResponse, RentalOffer, ReviewDecision, StressAiInterpretation, StressResult, StressScenario } from '../types/rental'

const messages: Record<number, string> = {
  413: 'The PDF exceeds the 10 MB limit. Choose a smaller file.',
  415: 'This file is not a supported PDF.',
  429: 'Gemini is at its request limit. Wait a minute and try again.',
  502: 'The document service could not process this request. You can retry or enter terms manually.',
  503: 'Gemini extraction is unavailable. Manual entry still works.',
  504: 'The document service took too long to respond. You can paste the lease text instead, or enter your rental terms manually.',
}

async function rentalRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response
  try { response = await fetch(`/api${path}`, options) }
  catch { throw new ApiError('Cannot connect to NestWise. Check that FastAPI and the Vite proxy are running.') }
  if (!response.ok) {
    let detail = ''
    try {
      const payload = await response.json() as { detail?: string | { location?: (string | number)[]; message?: string }[] }
      if (typeof payload.detail === 'string') detail = payload.detail
      else if (Array.isArray(payload.detail)) detail = payload.detail.slice(0, 3).map(item => `${item.location?.join('.') || 'Request'}: ${item.message || 'invalid value'}`).join('; ')
    } catch { /* A proxy may return a non-JSON error page. */ }
    const safeDetail = response.status === 422
      ? path === '/lease/extract-pdf'
        ? 'We could not read that PDF. Try another file, paste its text, or enter the rental terms manually.'
        : path === '/lease/extract-text'
          ? 'Paste some lease text to review, or enter the rental terms manually.'
          : 'Some reviewed terms could not be added to the rental. Check the values and try again.'
      : detail
    if (path === '/rental/decision-brief') {
      const briefMessage: Record<number, string> = {
        422: 'Check the rental terms and recalculate before requesting AI insights.',
        429: 'AI insights have reached their request limit. Your rental overview remains available.',
        502: 'AI insights could not be verified. Your rental overview remains available.',
        503: 'AI insights are unavailable here. Your rental overview remains available.',
        504: 'AI insights took too long. Your rental overview remains available.',
      }
      throw new ApiError(briefMessage[response.status] || 'AI insights are unavailable. Your rental overview remains available.', response.status)
    }
    if (path === '/rental/stress-explanation') {
      const aiMessage: Record<number, string> = {
        422: 'This stress scenario could not be evaluated. Check its assumptions and run it again.',
        429: 'AI explanations have reached their request limit. The deterministic interpretation remains available.',
        502: 'The AI explanation could not be verified. The deterministic interpretation remains available.',
        503: 'AI explanations are unavailable here. The deterministic interpretation remains available.',
        504: 'The AI explanation took too long. The deterministic interpretation remains available.',
      }
      throw new ApiError(aiMessage[response.status] || 'AI explanations are unavailable. The deterministic interpretation remains available.', response.status)
    }
    if (path === '/lease/explain-clause') {
      const clauseMessage: Record<number, string> = {
        422: 'Enter a short, meaningful lease excerpt to explain.',
        429: 'AI explanations have reached their request limit. You can continue the guided analysis without AI.',
        502: 'The explanation could not be verified. Keep the term marked unsure and ask for clarification.',
        503: 'AI clause explanation is unavailable. Continue with “I’m not sure” or ask for written clarification.',
        504: 'The explanation took too long. Keep the term marked unsure and continue the guided analysis.',
      }
      throw new ApiError(clauseMessage[response.status] || 'AI clause explanation is unavailable. Continue the guided analysis without it.', response.status)
    }
    if (path === '/rental/comparison-explanation') {
      const comparisonMessage: Record<number, string> = {
        422: 'The rentals could not be compared from the supplied terms. Check both offers and retry.',
        429: 'AI explanations have reached their request limit. The known-cost comparison remains available.',
        502: 'The AI explanation could not be verified. The measured comparison remains available.',
        503: 'AI explanation is unavailable. The measured comparison remains available.',
        504: 'The AI explanation took too long. The measured comparison remains available.',
      }
      throw new ApiError(comparisonMessage[response.status] || 'AI comparison explanation is unavailable. The measured comparison remains available.', response.status)
    }
    if (path === '/rental/follow-ups') {
      throw new ApiError('Suggested questions could not be refreshed. Recalculate the rental terms to try again.', response.status)
    }
    throw new ApiError(messages[response.status] || safeDetail || `Request failed (${response.status}).`, response.status)
  }
  try { return await response.json() as T }
  catch { throw new ApiError('The server returned an unreadable response.') }
}

const json = (value: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })

export async function leaseServiceStatus(): Promise<LeaseServiceStatus> {
  const result = await rentalRequest<LeaseServiceStatus>('/lease/status')
  if (typeof result.service_ready !== 'boolean') throw new ApiError('Lease service status is incomplete.')
  return result
}

function checkDraft(result: LeaseDraft): LeaseDraft {
  if (!result.draft_id || !Array.isArray(result.terms) || !result.terms.length || result.review_required !== true) throw new ApiError('The extraction response is incomplete.')
  return result
}

export async function extractLeaseText(text: string): Promise<LeaseDraft> {
  return checkDraft(await rentalRequest<LeaseDraft>('/lease/extract-text', json({ text })))
}

export async function extractLeasePdf(file: File): Promise<LeaseDraft> {
  const body = new FormData()
  body.append('file', file)
  return checkDraft(await rentalRequest<LeaseDraft>('/lease/extract-pdf', { method: 'POST', body }))
}

export async function confirmLease(draft: LeaseDraft, decisions: ReviewDecision[]): Promise<LeaseConfirmation> {
  const terms = new Map(draft.terms.map(term => [term.field_id, term.value]))
  const reviewedDecisions = decisions.map(decision => {
    if (decision.action !== 'accept') return decision
    const candidate = terms.get(decision.field_id)
    if (typeof candidate === 'boolean' && (decision.field_id === 'first_month_rent_due_upfront' || decision.field_id === 'last_month_rent_due_upfront')) {
      return { ...decision, value: candidate ? 'yes' : 'no' }
    }
    if (decision.field_id === 'recurring_charges' && Array.isArray(candidate)) {
      const charges = candidate.map((entry: unknown) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new ApiError('Review recurring fees and correct any amounts that are not clearly monthly.')
        const item = entry as Record<string, unknown>
        if (typeof item.name === 'string' && typeof item.monthly_amount === 'number' && Number.isFinite(item.monthly_amount)) {
          return { name: item.name, monthly_amount: item.monthly_amount }
        }
        if (typeof item.name === 'string' && item.frequency === 'monthly' && typeof item.amount === 'number' && Number.isFinite(item.amount)) {
          return { name: item.name, monthly_amount: item.amount }
        }
        throw new ApiError('Review recurring fees and correct any amounts that are not clearly monthly.')
      })
      return { ...decision, value: charges }
    }
    if (decision.field_id === 'utilities' && candidate && typeof candidate === 'object') {
      const utility = candidate as Record<string, unknown>
      if (utility.status === 'estimated') {
        const amount = utility.amount ?? utility.estimated_monthly_amount
        if (typeof amount === 'number' && Number.isFinite(amount)) return { ...decision, value: { status: 'estimated', amount, source_description: utility.source_description ?? utility.name } }
      }
      if (utility.status === 'included_in_rent') return { ...decision, value: { status: 'included_in_rent' } }
      if (Array.isArray(candidate) && candidate.length === 1 && candidate[0] && typeof candidate[0] === 'object') {
        const item = candidate[0] as Record<string, unknown>
        if (item.frequency === 'monthly' && typeof item.amount === 'number' && Number.isFinite(item.amount)) {
          return { ...decision, value: { status: 'estimated', amount: item.amount, source_description: item.name } }
        }
      }
    }
    return decision
  })
  const result = await rentalRequest<LeaseConfirmation>('/lease/confirm', json({ draft, decisions: reviewedDecisions }))
  if (!result.confirmed_offer?.rental_label || !Array.isArray(result.review_history)) throw new ApiError('The confirmed lease response is incomplete.')
  // Pydantic's model_dump(mode='json') sends Decimal offer amounts as strings.
  // Batch 4A intentionally accepts only JSON numbers on its request boundary.
  const numeric = (value: unknown): number => {
    const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN
    if (!Number.isFinite(parsed) || parsed < 0) throw new ApiError('A confirmed monetary term is invalid. Review the lease again.')
    return parsed
  }
  const offer = result.confirmed_offer
  offer.monthly_base_rent = numeric(offer.monthly_base_rent)
  if (offer.expected_roommate_contribution?.status === 'provided') offer.expected_roommate_contribution.amount = numeric(offer.expected_roommate_contribution.amount)
  offer.recurring_charges?.forEach(item => { item.monthly_amount = numeric(item.monthly_amount) })
  if (offer.utilities?.status === 'estimated') offer.utilities.estimated_monthly_amount = numeric(offer.utilities.estimated_monthly_amount)
  if (offer.upfront?.security_deposit?.status === 'provided') offer.upfront.security_deposit.amount = numeric(offer.upfront.security_deposit.amount)
  offer.upfront?.nonrefundable_fees?.forEach(item => { item.amount = numeric(item.amount) })
  offer.upfront?.other_charges?.forEach(item => { item.amount = numeric(item.amount) })
  if (offer.upfront?.holding_deposit) offer.upfront.holding_deposit.amount = numeric(offer.upfront.holding_deposit.amount)
  offer.concessions?.forEach(item => { if (item.amount !== undefined && item.amount !== null) item.amount = numeric(item.amount) })
  return result
}

export async function evaluateRental(offer: RentalOffer, financial_profile?: FinancialProfile): Promise<RentalEvaluation> {
  const result = await rentalRequest<RentalEvaluation>('/rental/evaluate', json({ offer, financial_profile }))
  if (!result.monthly_costs || !result.upfront || !result.lease_totals || !Array.isArray(result.month_by_month_cash_flow)) throw new ApiError('The rental evaluation is incomplete.')
  return result
}

export async function generateRentalDecisionBrief(offer: RentalOffer, financial_profile?: FinancialProfile, signal?: AbortSignal): Promise<RentalDecisionBrief> {
  const result = await rentalRequest<RentalDecisionBrief>('/rental/decision-brief', { ...json({ offer, financial_profile }), signal })
    if (result.source !== 'gemini' || !result.headline || !result.overall_summary || !Array.isArray(result.important_findings) || !Array.isArray(result.key_uncertainties) || !result.suggested_next_step || !Array.isArray(result.follow_ups) || !Array.isArray(result.additional_follow_ups)) {
    throw new ApiError('AI insights could not be verified. Your rental overview remains available.')
  }
  return result
}

export async function getRentalFollowUps(offer: RentalOffer, financial_profile?: FinancialProfile, signal?: AbortSignal): Promise<RentalFollowUpResponse> {
  const result = await rentalRequest<RentalFollowUpResponse>('/rental/follow-ups', { ...json({ offer, financial_profile }), signal })
  if (result.source !== 'deterministic' || !Array.isArray(result.follow_ups) || !Array.isArray(result.additional_follow_ups)) {
    throw new ApiError('Suggested questions could not be verified.')
  }
  return result
}

export async function compareRentals(left_offer: RentalOffer, right_offer: RentalOffer, financial_profile?: FinancialProfile): Promise<RentalComparison> {
  const result = await rentalRequest<RentalComparison>('/rental/compare', json({ left_offer, right_offer, financial_profile }))
  if (!result.left?.monthly_costs || !result.right?.monthly_costs || !result.differences?.left_minus_right || result.interpretation?.source !== 'deterministic' || !result.interpretation.main_tradeoff) throw new ApiError('The rental comparison is incomplete.')
  return result
}

export async function stressRental(offer: RentalOffer, scenario: StressScenario, financial_profile?: FinancialProfile): Promise<StressResult> {
  const result = await rentalRequest<StressResult>('/rental/stress-test', json({ offer, scenario, financial_profile }))
  if (!result.baseline || !result.stressed || !result.summary || !Array.isArray(result.affected_months)) throw new ApiError('The stress result is incomplete.')
  return result
}

export async function explainStress(offer: RentalOffer, scenario: StressScenario, financial_profile?: FinancialProfile, signal?: AbortSignal): Promise<StressAiInterpretation> {
  const result = await rentalRequest<StressAiInterpretation>('/rental/stress-explanation', { ...json({ offer, scenario, financial_profile }), signal })
  if (result.source !== 'gemini' || !result.headline || !result.main_consequence || !Array.isArray(result.statement_ids)) throw new ApiError('The AI scenario explanation is incomplete.')
  return result
}

export async function explainLeaseClause(clause_text: string, context: 'deposit' | 'move_in_payment' | 'monthly_charge' | 'utilities' | 'prepaid_rent' | 'lease_obligation', signal?: AbortSignal): Promise<ClauseExplanation> {
  const result = await rentalRequest<ClauseExplanation>('/lease/explain-clause', { ...json({ clause_text, context }), signal })
  if (result.source !== 'gemini' || typeof result.can_analyze !== 'boolean' || !Array.isArray(result.important_uncertainties) || !Array.isArray(result.questions_to_ask) || !result.legal_note) throw new ApiError('The clause explanation could not be verified.')
  return result
}

export async function explainRentalComparison(left_offer: RentalOffer, right_offer: RentalOffer, financial_profile?: FinancialProfile, signal?: AbortSignal): Promise<RentalComparisonExplanation> {
  const result = await rentalRequest<RentalComparisonExplanation>('/rental/comparison-explanation', { ...json({ left_offer, right_offer, financial_profile }), signal })
  if (result.source !== 'gemini' || !result.main_tradeoff || !result.upfront_comparison || !result.monthly_and_lease_comparison || !Array.isArray(result.statement_ids)) throw new ApiError('The comparison explanation could not be verified.')
  return result
}
