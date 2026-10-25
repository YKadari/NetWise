import { ApiError } from './api'
import type { FinancialProfile, LeaseConfirmation, LeaseDraft, LeaseServiceStatus, RentalComparison, RentalEvaluation, RentalOffer, ReviewDecision, StressResult, StressScenario } from '../types/rental'

const messages: Record<number, string> = {
  413: 'The PDF exceeds the 10 MB limit. Choose a smaller file.',
  415: 'This file is not a supported PDF.',
  429: 'Gemini is at its request limit. Wait a minute and try again.',
  502: 'The document service could not process this request. You can retry or enter terms manually.',
  503: 'Gemini extraction is unavailable. Manual entry still works.',
  504: 'Gemini took too long to respond. Retry with a shorter document.',
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
    const safeDetail = response.status === 422 ? 'Some reviewed terms could not be added to the rental. Check the values and try again.' : detail
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

export async function compareRentals(left_offer: RentalOffer, right_offer: RentalOffer, financial_profile?: FinancialProfile): Promise<RentalComparison> {
  const result = await rentalRequest<RentalComparison>('/rental/compare', json({ left_offer, right_offer, financial_profile }))
  if (!result.left?.monthly_costs || !result.right?.monthly_costs || !result.differences?.left_minus_right) throw new ApiError('The rental comparison is incomplete.')
  return result
}

export async function stressRental(offer: RentalOffer, scenario: StressScenario, financial_profile?: FinancialProfile): Promise<StressResult> {
  const result = await rentalRequest<StressResult>('/rental/stress-test', json({ offer, scenario, financial_profile }))
  if (!result.baseline || !result.stressed || !result.summary || !Array.isArray(result.affected_months)) throw new ApiError('The stress result is incomplete.')
  return result
}
