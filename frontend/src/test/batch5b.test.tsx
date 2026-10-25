import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { ProductNavigation, type ProductView } from '../components/ProductNavigation'
import { RentalInput } from '../components/RentalInput'
import { LeaseInput } from '../components/LeaseInput'
import { LeaseReview } from '../components/LeaseReview'
import { RentalResults } from '../components/RentalResults'
import { RentalStressPanel } from '../components/RentalStressPanel'
import { RentalComparison } from '../components/RentalComparison'
import { RentalWorkspace } from '../components/RentalWorkspace'
import { confirmLease, extractLeaseText, evaluateRental } from '../lib/rentalApi'
import { demoOffers, manualToOffer, blankManual, profileToRequest, blankProfile, money, offerToManual } from '../lib/rentalForms'
import type { LeaseDraft, RentalEvaluation, StressScenario } from '../types/rental'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const candidate = (field_id: LeaseDraft['terms'][number]['field_id'], value: unknown) => ({ field_id, value, source_excerpt: `${field_id} appears here`, page_reference: null, status: 'explicit' as const, uncertainty_note: null, evidence_verification: 'unverified' as const, review_state: 'needs_review' as const })
const draft: LeaseDraft = { draft_id: 'synthetic-draft', source_type: 'pasted_text', review_required: true, general_warnings: [], terms: [candidate('rental_label', 'Synthetic A'), candidate('monthly_base_rent', 1450), candidate('lease_term_months', 12)] }
const evaluation: RentalEvaluation = {
  rental_label: 'Synthetic A', lease: { term_months: 12 },
  monthly_costs: { base_rent_before_concessions: 1450, gross_known_monthly_housing_obligation: 1830, average_modeled_housing_obligation: 1830, recurring_charges_known_subtotal: 200, utilities_known_subtotal: 180, monthly_costs_complete: true, expected_personal_monthly_share: 1830 },
  upfront: { upfront_cash_required: 5300, upfront_cash_complete: true, refundable_cash_held: 2000, potential_deposit_refund_not_guaranteed: 2000, unknown_upfront_terms: [] },
  lease_totals: { known_modeled_nonrefundable_lease_cost: 22360, nonrefundable_cost_complete: true, known_total_cash_outflows_including_refundable_holds: 24360, cash_outflow_total_complete: true },
  financial_profile: null,
  month_by_month_cash_flow: [{ month: 1, calendar_month: null, base_rent_after_concessions: 1450, recurring_charges_after_concessions: 200, estimated_utilities_after_concessions: 180, gross_contractual_housing_expense: 1830, modeled_renter_housing_share: 1830, rent_prepayment_allocated: 1450, rent_cash_due_this_month: 0, monthly_nonrent_cash_due: 380, cash_remaining_from_monthly_income_after_scheduled_payments: null }],
  unknown_cost_categories: [], warnings: [], assumptions: [],
}
const jsonResponse = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const openSampleResult = async () => {
  fireEvent.click(screen.getByRole('button', { name: /Try with example data/ }))
  for (let n = 0; n < 3; n++) fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  fireEvent.click(screen.getByRole('button', { name: 'See my rental costs' }))
  return screen.findByLabelText('Rental evaluation results')
}
const openLeaseInput = async () => {
  fireEvent.click(screen.getByRole('button', { name: /Start rental analysis/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Use the detailed manual form instead' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Analyze lease text instead' }))
}

describe('Batch 5B navigation and manual entry', () => {
  it('switches between the three product experiences with keyboard-accessible buttons', () => {
    function Nav() { const [view, setView] = useState<ProductView>('explore'); return <ProductNavigation view={view} onChange={setView}/> }
    render(<Nav/>)
    const analyze = screen.getByRole('button', { name: /Analyze/ })
    analyze.focus()
    expect(document.activeElement).toBe(analyze)
    fireEvent.click(analyze)
    expect(analyze).toHaveAttribute('aria-current', 'page')
    fireEvent.click(screen.getByRole('button', { name: /Compare/ }))
    expect(screen.getByRole('button', { name: /Compare/ })).toHaveAttribute('aria-current', 'page')
  })
  it('keeps unknown, none, and provided rental terms distinct', () => {
    const form = blankManual()
    form.label = 'Synthetic studio'; form.rent = '1200'; form.depositStatus = 'none'; form.firstPrepaid = 'unknown'; form.lastPrepaid = 'no'
    const offer = manualToOffer(form)
    expect(offer.upfront?.security_deposit).toEqual({ status: 'none' })
    expect(offer.upfront?.first_month_rent_due_upfront).toBe('unknown')
    expect(offer.recurring_charges_status).toBe('unknown')
    expect(offer.utilities?.status).toBe('unknown')
    expect(() => profileToRequest(blankProfile())).toThrow(/take-home/)
  })
  it('submits a valid manual offer without Gemini', () => {
    const onEvaluate = vi.fn()
    render(<RentalInput busy={false} onEvaluate={onEvaluate}/>)
    fireEvent.change(screen.getByLabelText('Rental name'), { target: { value: 'Synthetic studio' } })
    fireEvent.change(screen.getByLabelText('Advertised monthly rent'), { target: { value: '1200' } })
    fireEvent.click(screen.getByRole('button', { name: 'Calculate my rental costs' }))
    expect(onEvaluate).toHaveBeenCalledWith(expect.objectContaining({ rental_label: 'Synthetic studio', monthly_base_rent: 1200 }))
  })
  it('loads the two existing synthetic offers with different charges and move-in cash', () => {
    expect(demoOffers[0].monthly_base_rent).toBeLessThan(demoOffers[1].monthly_base_rent)
    expect(demoOffers[0].recurring_charges?.reduce((sum, item) => sum + item.monthly_amount, 0)).toBeGreaterThan(demoOffers[1].recurring_charges?.reduce((sum, item) => sum + item.monthly_amount, 0) || 0)
    expect(demoOffers[0].upfront?.security_deposit?.amount).toBeGreaterThan(demoOffers[1].upfront?.security_deposit?.amount || 0)
  })
})

describe('lease extraction and explicit review', () => {
  it('rejects invalid PDFs before submission and preserves the selected name', () => {
    const onPdf = vi.fn()
    render(<LeaseInput initialMethod="pdf" status={{ configured: true, service_ready: true, model: 'test' }} busy={false} error={null} onText={vi.fn()} onPdf={onPdf}/>)
    const input = screen.getByLabelText('PDF lease file')
    fireEvent.change(input, { target: { files: [new File(['not pdf'], 'lease.txt', { type: 'text/plain' })] } })
    expect(screen.getByText(/Selected: lease.txt/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Extract PDF terms' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a PDF file')
    expect(onPdf).not.toHaveBeenCalled()
  })
  it('submits pasted lease text and reports provider errors by status', async () => {
    const mocked = vi.fn().mockResolvedValueOnce(jsonResponse({ detail: 'Gemini extraction is unavailable' }, 503))
    vi.stubGlobal('fetch', mocked)
    await expect(extractLeaseText('synthetic lease')).rejects.toThrow(/Manual entry still works/)
    expect(JSON.parse(mocked.mock.calls[0][1].body)).toEqual({ text: 'synthetic lease' })
  })
  it('shows a concise summary and requires an intentional review confirmation', () => {
    const onConfirm = vi.fn()
    render(<LeaseReview draft={{ ...draft, terms: [...draft.terms, { field_id: 'security_deposit', value: null, source_excerpt: null, page_reference: null, status: 'not_found', uncertainty_note: 'Not found', evidence_verification: 'missing', review_state: 'needs_review' }] }} busy={false} error={null} onConfirm={onConfirm} onBack={vi.fn()}/>)
    expect(screen.getByRole('heading', { name: "Here's what we found in your lease." })).toBeInTheDocument()
    expect(screen.getByLabelText('Monthly rent')).toHaveValue(1450)
    expect(screen.getByLabelText('Lease duration in months')).toHaveValue(12)
    expect(screen.getByLabelText('Essential rental details')).toBeInTheDocument()
    expect(screen.getByLabelText('Move-in costs')).toBeInTheDocument()
    expect(screen.getByLabelText('Monthly costs')).toBeInTheDocument()
    expect(screen.getByLabelText('Questions worth asking')).toBeInTheDocument()
    expect(screen.queryByText(/of 4 terms reviewed/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'See my rental costs' })).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/I've checked the rent, lease length/))
    fireEvent.click(screen.getByRole('button', { name: 'See my rental costs' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onConfirm.mock.calls[0][0]).toHaveLength(4)
    expect(onConfirm.mock.calls[0][0]).toContainEqual({ field_id: 'security_deposit', action: 'mark_unknown' })
  })
  it('requires missing rent and lease duration while allowing a renter to name the home', () => {
    const terms = [
      { ...candidate('rental_label', 'Synthetic lease'), evidence_verification: 'verified_text' as const },
      { ...candidate('monthly_base_rent', 1450), status: 'ambiguous' as const, value: null },
      { ...candidate('lease_term_months', 12), status: 'contradictory' as const, value: null, evidence_verification: 'unverified' as const },
      { ...candidate('recurring_charges', []), status: 'not_found' as const, value: null },
    ]
    render(<LeaseReview draft={{ ...draft, terms }} busy={false} error={null} onConfirm={vi.fn()} onBack={vi.fn()}/> )
    expect(screen.getByLabelText('Monthly rent')).toHaveValue(null)
    expect(screen.getByLabelText('Lease duration in months')).toHaveValue(null)
    expect(screen.getByLabelText(/Rental name/)).toHaveValue('Synthetic lease')
    expect(screen.getByRole('button', { name: 'See my rental costs' })).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/I've checked the rent, lease length/))
    fireEvent.click(screen.getByRole('button', { name: 'See my rental costs' }))
    expect(screen.getByRole('status')).toHaveTextContent('Enter the monthly rent')
    fireEvent.change(screen.getByLabelText('Monthly rent'), { target: { value: '1600' } })
    fireEvent.change(screen.getByLabelText('Lease duration in months'), { target: { value: '12' } })
    fireEvent.click(screen.getByLabelText(/I've checked the rent, lease length/))
    expect(screen.getByRole('button', { name: 'See my rental costs' })).toBeEnabled()
  })
  it('keeps evidence on demand and labels unverified excerpts honestly', () => {
    const verified = { ...candidate('monthly_base_rent', 1450), evidence_verification: 'verified_text' as const }
    render(<LeaseReview draft={{ ...draft, terms: [draft.terms[0], verified, draft.terms[2]] }} busy={false} error={null} onConfirm={vi.fn()} onBack={vi.fn()}/> )
    expect(screen.getAllByText(/View source/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Matched to your lease text.').length).toBeGreaterThan(0)
    expect(screen.getAllByText('AI suggested this excerpt. Please verify it against your lease.').length).toBeGreaterThan(0)
    expect(screen.queryByText(/source_excerpt|evidence_verification/)).not.toBeInTheDocument()
  })
  it('does not invent evidence excerpts or PDF page numbers when evidence is missing', () => {
    const missing = { field_id: 'security_deposit' as const, value: 1000, source_excerpt: null, page_reference: null, status: 'explicit' as const, uncertainty_note: null, evidence_verification: 'missing' as const, review_state: 'needs_review' as const }
    render(<LeaseReview draft={{ ...draft, terms: [...draft.terms, missing] }} busy={false} error={null} onConfirm={vi.fn()} onBack={vi.fn()}/> )
    expect(screen.getByText('No supporting excerpt was provided.')).toBeInTheDocument()
    expect(screen.queryByText(/Page \d+/)).not.toBeInTheDocument()
    expect(screen.getAllByText('Not confirmed').length).toBeGreaterThan(0)
  })
  it('lets renters correct monthly fees without editing JSON and sends corrections separately from the draft', () => {
    const onConfirm = vi.fn()
    const fee = candidate('recurring_charges', [{ name: 'Internet', amount: 40, frequency: 'monthly' }])
    const sourceDraft = { ...draft, terms: [...draft.terms, fee] }
    const original = JSON.stringify(sourceDraft)
    render(<LeaseReview draft={sourceDraft} busy={false} error={null} onConfirm={onConfirm} onBack={vi.fn()}/> )
    const monthly = screen.getByLabelText('Monthly costs')
    fireEvent.click(within(monthly).getByRole('button', { name: 'Edit monthly fees identified' }))
    fireEvent.change(screen.getByLabelText('Fee amount 1'), { target: { value: '55' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save corrected charges' }))
    fireEvent.click(screen.getByLabelText(/I've checked the rent, lease length/))
    fireEvent.click(screen.getByRole('button', { name: 'See my rental costs' }))
    expect(onConfirm.mock.calls[0][0]).toContainEqual({ field_id: 'recurring_charges', action: 'correct', value: [{ name: 'Internet', monthly_amount: 55 }] })
    expect(JSON.stringify(sourceDraft)).toBe(original)
  })
  it('shows refundable and nonrefundable move-in charges separately without inventing a total', () => {
    const fees = candidate('other_charges', [{ name: 'Pet deposit', amount: 250, refundable: true }, { name: 'Application fee', amount: 75, refundable: false }])
    render(<LeaseReview draft={{ ...draft, terms: [...draft.terms, fees] }} busy={false} error={null} onConfirm={vi.fn()} onBack={vi.fn()}/> )
    expect(screen.getByText(/Pet deposit — \$250 \(refundable\)/)).toBeInTheDocument()
    expect(screen.getByText(/Application fee — \$75 \(nonrefundable\)/)).toBeInTheDocument()
    expect(screen.getByText(/We don't add a preliminary upfront total here/)).toBeInTheDocument()
  })
  it('makes a possible utility duplicate an explicit clarification before confirmation', () => {
    const charges = candidate('recurring_charges', [{ name: 'Utilities', amount: 130, frequency: 'monthly' }])
    const utilities = candidate('utilities', { status: 'estimated', amount: 130 })
    render(<LeaseReview draft={{ ...draft, terms: [...draft.terms, charges, utilities] }} busy={false} error={null} onConfirm={vi.fn()} onBack={vi.fn()}/> )
    expect(screen.getByText(/Check for a duplicate/)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/I've checked the rent, lease length/))
    expect(screen.getByRole('button', { name: 'See my rental costs' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(/whether utilities are already included/i)
    fireEvent.click(screen.getByRole('button', { name: 'These are separate costs' }))
    fireEvent.click(screen.getByLabelText(/I've checked the rent, lease length/))
    expect(screen.getByRole('button', { name: 'See my rental costs' })).toBeEnabled()
  })
  it('converts only confirmed offer money fields to JSON numbers for the rental API', async () => {
    const returned = { ...demoOffers[0], monthly_base_rent: '1450.00', recurring_charges: [{ name: 'Parking', monthly_amount: '150.00' }], utilities: { status: 'estimated', estimated_monthly_amount: '180.00' }, upfront: { security_deposit: { status: 'provided', amount: '2000.00' } } }
    const mocked = vi.fn().mockResolvedValueOnce(jsonResponse({ confirmed_offer: returned, review_history: [], confirmed_clauses: {} })).mockResolvedValueOnce(jsonResponse(evaluation))
    vi.stubGlobal('fetch', mocked)
    const confirmed = await confirmLease(draft, draft.terms.map(term => ({ field_id: term.field_id, action: 'accept' })))
    expect(confirmed.confirmed_offer.monthly_base_rent).toBe(1450)
    expect(confirmed.confirmed_offer.upfront?.security_deposit?.amount).toBe(2000)
    await evaluateRental(confirmed.confirmed_offer)
    const request = JSON.parse(mocked.mock.calls[1][1].body)
    expect(request.offer.recurring_charges[0].monthly_amount).toBe(150)
    expect(request.offer.utilities.estimated_monthly_amount).toBe(180)
    expect(request.offer.monthly_base_rent).toBe(1450)
  })
  it('normalizes accepted Gemini term shapes for the existing confirmation contract without changing the draft', async () => {
    const terms = [
      candidate('recurring_charges', [{ name: 'Internet', amount: 40, frequency: 'monthly' }]),
      candidate('utilities', [{ name: 'Utilities', amount: 130, frequency: 'monthly' }]),
      candidate('first_month_rent_due_upfront', true),
      candidate('last_month_rent_due_upfront', false),
    ]
    const extracted: LeaseDraft = { ...draft, terms }
    const before = JSON.stringify(extracted)
    const mocked = vi.fn().mockResolvedValue(jsonResponse({ confirmed_offer: demoOffers[0], review_history: [], confirmed_clauses: {} }))
    vi.stubGlobal('fetch', mocked)
    await confirmLease(extracted, terms.map(term => ({ field_id: term.field_id, action: 'accept' as const })))
    const body = JSON.parse((mocked.mock.calls[0][1] as RequestInit).body as string)
    expect(body.draft).toEqual(extracted)
    expect(body.decisions).toEqual([
      { field_id: 'recurring_charges', action: 'accept', value: [{ name: 'Internet', monthly_amount: 40 }] },
      { field_id: 'utilities', action: 'accept', value: { status: 'estimated', amount: 130, source_description: 'Utilities' } },
      { field_id: 'first_month_rent_due_upfront', action: 'accept', value: 'yes' },
      { field_id: 'last_month_rent_due_upfront', action: 'accept', value: 'no' },
    ])
    expect(JSON.stringify(extracted)).toBe(before)
  })
  it('does not echo raw confirmation validation details to the frontend', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ detail: 'invalid lease contents and secret value' }, 422)))
    let message = ''
    try { await confirmLease(draft, draft.terms.map(term => ({ field_id: term.field_id, action: 'accept' }))) }
    catch (cause) { message = cause instanceof Error ? cause.message : String(cause) }
    expect(message).toContain('Some reviewed terms could not be added')
    expect(message).not.toContain('secret value')
  })
})

describe('financial results, stress, and comparison', () => {
  it('labels incomplete cost figures as known subtotals', () => {
    const incompleteOffer = { ...demoOffers[0], recurring_charges_status: 'unknown' as const, utilities: { status: 'unknown' as const }, upfront: { ...demoOffers[0].upfront, other_charges_status: 'unknown' as const } }
    render(<RentalResults offer={incompleteOffer} result={{ ...evaluation, monthly_costs: { ...evaluation.monthly_costs, monthly_costs_complete: false }, unknown_cost_categories: ['utilities', 'recurring_charges', 'other_upfront_charges'] }} onSave={vi.fn()} savedSlot={null}/>)
    expect(screen.getByText('Known monthly subtotal')).toBeInTheDocument()
    expect(screen.getByText(/Some rental costs have not been confirmed/)).toHaveTextContent('utilities')
    expect(screen.getByText(/Listed monthly fees: Not confirmed\. Utilities: Not confirmed\./)).toBeInTheDocument()
    expect(screen.getByText(/Known-term personal share/)).toBeInTheDocument()
    expect(screen.getByText('Refundable deposits')).toBeInTheDocument()
  })
  it('submits utility and early-departure scenarios with explicit assumptions', () => {
    const onRun = vi.fn<(scenario: StressScenario) => void>()
    render(<RentalStressPanel offer={demoOffers[0]} busy={false} error={null} result={null} onRun={onRun}/>)
    fireEvent.click(screen.getByRole('button', { name: 'Utilities become more expensive' }))
    fireEvent.click(screen.getByRole('button', { name: 'Run scenario' }))
    expect(onRun).toHaveBeenCalledWith({ type: 'utility_increase', additional_monthly_amount: 100, first_affected_month: 1, last_affected_month: 12 })
    fireEvent.click(screen.getByRole('button', { name: 'You need to leave early' }))
    fireEvent.change(screen.getByLabelText('Treatment'), { target: { value: 'hypothetical_settlement' } })
    fireEvent.change(screen.getByLabelText('Hypothetical fee'), { target: { value: '2000' } })
    fireEvent.change(screen.getByLabelText('Assumption or source note'), { target: { value: 'Synthetic only' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run scenario' }))
    expect(onRun).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'early_departure', departure_month: 8, treatment: 'hypothetical_settlement', termination_fee: 2000, remaining_rent_treatment: 'unknown' }))
  })
  it('does not present unknown early-departure consequences or future rent as zero', () => {
    const result = {
      scenario_type: 'early_departure' as const,
      assumptions: { treatment: 'unknown_consequences', remaining_rent_treatment: 'unknown' },
      affected_months: [9, 10, 11, 12], baseline: evaluation,
      stressed: { month_by_month: [], financial_resilience: {}, known_departure_cash_impact: 0, specified_remaining_rent: 0, prepaid_rent_credit_applied: 0, continuing_rent_cash_due_after_prepaid_credit: 0 },
      summary: { unknown_cost_categories: ['early_departure_consequences', 'remaining_rent_obligation'] },
      warnings: [], explanation: 'This is an explicit settlement scenario.', result_is_hypothetical_not_a_forecast: true,
      interpretation: { source: 'deterministic' as const, headline: 'Early departure scenario', what_changed: 'The scenario assumes departure after month 8.', main_consequence: 'Known modeled departure cash impact is $0; this may be incomplete.', why_it_matters: 'The result includes only entered amounts.', what_to_watch: 'Future obligations remain unknown.', what_to_consider: 'Review the written terms.' },
    }
    render(<RentalStressPanel offer={demoOffers[0]} busy={false} error={null} result={result} onRun={vi.fn()}/> )
    expect(screen.getByText(/No legal or contractual outcome has been entered/)).toBeInTheDocument()
    expect(screen.getByText('Future rent and legal consequences').parentElement).toHaveTextContent('Unknown')
    expect(screen.getByText(/Continuing rent cash due is unknown/)).toBeInTheDocument()
    expect(screen.queryByText(/Continuing rent cash due after credit: \$0/)).not.toBeInTheDocument()
  })
  it('shows deterministic meaning without AI and requests a grounded explanation only on explicit action', async () => {
    const scenario: StressScenario = { type: 'utility_increase', additional_monthly_amount: 100, first_affected_month: 1, last_affected_month: 2 }
    const result = {
      scenario_type: 'utility_increase' as const, assumptions: {}, affected_months: [1, 2], baseline: evaluation,
      stressed: { month_by_month: [], financial_resilience: {} }, summary: { total_additional_personal_cash_burden: 200 },
      warnings: [], explanation: 'Hypothetical scenario.', result_is_hypothetical_not_a_forecast: true,
      interpretation: { source: 'deterministic' as const, headline: 'Utility increase scenario', what_changed: 'Adds $100/month for two months.', main_consequence: 'Modeled added burden is $200.', why_it_matters: 'It uses more of your budget.', what_to_watch: 'The increase is hypothetical.', what_to_consider: 'Check your budget.' },
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ source: 'gemini', headline: 'Utility increase scenario', what_changed: 'Adds $100/month for two months.', main_consequence: 'Modeled added burden is $200.', why_it_matters: 'It uses more of your budget.', what_to_watch: 'The increase is hypothetical.', what_to_consider: 'Check your budget.', statement_ids: ['scenario', 'utility', 'burden', 'budget', 'assumption', 'action'] }))
    vi.stubGlobal('fetch', fetchMock)
    render(<RentalStressPanel offer={demoOffers[0]} status={{ configured: true, model: 'test', service_ready: true }} scenario={scenario} busy={false} error={null} result={result} onRun={vi.fn()}/> )
    expect(screen.getByRole('region', { name: 'What this scenario means' })).toHaveTextContent('Adds $100/month for two months.')
    const action = screen.getByRole('button', { name: 'Explain this scenario with AI' })
    action.focus()
    expect(document.activeElement).toBe(action)
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(action)
    expect(await screen.findByText('AI-prioritized interpretation')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/rental/stress-explanation')
  })
  it('compares two saved offers using the API response and flags unequal terms', async () => {
      const interpretation = { source: 'deterministic', main_tradeoff: 'Different measured costs.', upfront_comparison: 'Known move-in values.', monthly_and_lease_comparison: 'Measured monthly values.', important_uncertainties: 'No unknowns reported.', what_could_change_the_decision: 'Confirm written terms.' }
      const result = { left: evaluation, right: { ...evaluation, rental_label: 'Synthetic B' }, differences: { left_minus_right: { base_rent_per_month: -150 }, lease_terms_differ: true, total_period_costs_directly_comparable: false, unknown_cost_categories: { left: [], right: [] } }, comparison_notes: ['Lease durations differ.'], method: 'Shared profile.', interpretation }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(result)))
    render(<RentalComparison a={demoOffers[0]} b={demoOffers[1]} onEdit={vi.fn()} onDemo={vi.fn()}/>)
    fireEvent.click(screen.getByRole('button', { name: 'Compare the offers' }))
    expect(await screen.findByText(/Lease lengths differ/)).toBeInTheDocument()
    expect(within(screen.getByLabelText('Rental comparison results')).getByText('Measured differences')).toBeInTheDocument()
  })
    it('shows deterministic tradeoffs first and requests AI prioritization only after an explicit action', async () => {
      const deterministic = { source: 'deterministic', main_tradeoff: 'Measured tradeoffs; no winner.', upfront_comparison: 'A: $2,000; B: $2,100.', monthly_and_lease_comparison: 'Known monthly totals are subtotals.', important_uncertainties: 'Utilities remain unknown.', what_could_change_the_decision: 'Confirm written terms.' }
      const comparison = { left: evaluation, right: evaluation, differences: { left_minus_right: {}, lease_terms_differ: false, total_period_costs_directly_comparable: true, unknown_cost_categories: { left: [], right: [] } }, comparison_notes: [], method: 'Synthetic.', interpretation: deterministic }
      const ai = { source: 'gemini', main_tradeoff: 'Prioritized known costs.', upfront_comparison: 'Review move-in cash.', monthly_and_lease_comparison: 'Check recurring amounts.', important_uncertainties: 'Utilities are unknown.', what_could_change_the_decision: 'Ask for itemized terms.', statement_ids: ['a','b','c','d','e'] }
      const mocked = vi.fn().mockImplementation((url: string) => Promise.resolve(jsonResponse(url.endsWith('/comparison-explanation') ? ai : comparison)))
      vi.stubGlobal('fetch', mocked)
      render(<RentalComparison a={demoOffers[0]} b={demoOffers[1]} status={{ configured: true, model: 'test', service_ready: true }} onEdit={vi.fn()} onDemo={vi.fn()}/> )
      fireEvent.click(screen.getByRole('button', { name: 'Compare the offers' }))
      expect(await screen.findByText('Measured tradeoffs; no winner.')).toBeInTheDocument()
      expect(mocked).toHaveBeenCalledTimes(1)
      fireEvent.click(screen.getByRole('button', { name: 'Explain these tradeoffs with AI' }))
      expect(await screen.findByText('Prioritized known costs.')).toBeInTheDocument()
      expect(String(mocked.mock.calls[1][0])).toBe('/api/rental/comparison-explanation')
    })
    it('discards an AI explanation when either comparison offer changes', async () => {
      const deterministic = { source: 'deterministic', main_tradeoff: 'Current tradeoff.', upfront_comparison: 'Upfront.', monthly_and_lease_comparison: 'Monthly.', important_uncertainties: 'Unknowns.', what_could_change_the_decision: 'Confirm.' }
      const comparison = { left: evaluation, right: evaluation, differences: { left_minus_right: {}, lease_terms_differ: false, total_period_costs_directly_comparable: true, unknown_cost_categories: { left: [], right: [] } }, comparison_notes: [], method: 'Synthetic.', interpretation: deterministic }
      let resolveAi: ((response: ReturnType<typeof jsonResponse>) => void) | undefined
      const mocked = vi.fn((url: string) => url.endsWith('/comparison-explanation') ? new Promise<ReturnType<typeof jsonResponse>>(resolve => { resolveAi = resolve }) : Promise.resolve(jsonResponse(comparison)))
      vi.stubGlobal('fetch', mocked)
      const view = render(<RentalComparison a={demoOffers[0]} b={demoOffers[1]} status={{ configured: true, model: 'test', service_ready: true }} onEdit={vi.fn()} onDemo={vi.fn()}/> )
      fireEvent.click(screen.getByRole('button', { name: 'Compare the offers' }))
      await screen.findByText('Current tradeoff.')
      fireEvent.click(screen.getByRole('button', { name: 'Explain these tradeoffs with AI' }))
      view.rerender(<RentalComparison a={{ ...demoOffers[0], rental_label: 'Changed offer' }} b={demoOffers[1]} status={{ configured: true, model: 'test', service_ready: true }} onEdit={vi.fn()} onDemo={vi.fn()}/> )
      resolveAi?.(jsonResponse({ source: 'gemini', main_tradeoff: 'Stale answer.', upfront_comparison: '', monthly_and_lease_comparison: '', important_uncertainties: '', what_could_change_the_decision: '', statement_ids: [] }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Compare the offers' })).toBeEnabled())
      expect(screen.queryByText('Stale answer.')).not.toBeInTheDocument()
    })
  it('shows one clear comparison action when both saved slots exist and labels replacement explicitly', () => {
    const onCompare = vi.fn()
    const onSave = vi.fn()
    render(<RentalResults offer={demoOffers[0]} result={evaluation} onSave={onSave} savedSlot={null} hasSavedA hasSavedB onCompare={onCompare}/> )
    expect(screen.getByRole('button', { name: 'View comparison' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Compare rentals' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Save or replace a comparison offer'))
    expect(screen.getByRole('button', { name: 'Replace Rental A' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View comparison' }))
    expect(onCompare).toHaveBeenCalledOnce()
    expect(onSave).not.toHaveBeenCalled()
  })
  it('does not show an old comparison after either selected offer changes', async () => {
    let resolveResponse: ((value: ReturnType<typeof jsonResponse>) => void) | undefined
    const mocked = vi.fn(() => new Promise<ReturnType<typeof jsonResponse>>(resolve => { resolveResponse = resolve }))
    vi.stubGlobal('fetch', mocked)
    const first = render(<RentalComparison a={demoOffers[0]} b={demoOffers[1]} onEdit={vi.fn()} onDemo={vi.fn()}/> )
    fireEvent.click(screen.getByRole('button', { name: 'Compare the offers' }))
    first.rerender(<RentalComparison a={{ ...demoOffers[0], rental_label: 'Replacement A' }} b={demoOffers[1]} onEdit={vi.fn()} onDemo={vi.fn()}/> )
      resolveResponse?.(jsonResponse({ left: evaluation, right: evaluation, differences: { left_minus_right: {}, lease_terms_differ: false, total_period_costs_directly_comparable: true, unknown_cost_categories: { left: [], right: [] } }, comparison_notes: [], method: 'Synthetic.', interpretation: { source: 'deterministic', main_tradeoff: 'A minus B', upfront_comparison: '', monthly_and_lease_comparison: '', important_uncertainties: '', what_could_change_the_decision: '' } }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Compare the offers' })).toBeEnabled())
    expect(screen.queryByLabelText('Rental comparison results')).not.toBeInTheDocument()
  })
  it('runs a complete review-to-evaluation path without persisting lease text', async () => {
    const mocked = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/lease/status')) return Promise.resolve(jsonResponse({ configured: true, service_ready: true, model: 'synthetic-test' }))
      if (url.endsWith('/lease/extract-text')) return Promise.resolve(jsonResponse(draft))
      if (url.endsWith('/lease/confirm')) return Promise.resolve(jsonResponse({ confirmed_offer: { ...demoOffers[0], monthly_base_rent: '1450.00' }, review_history: [], confirmed_clauses: {} }))
      if (url.endsWith('/rental/evaluate')) return Promise.resolve(jsonResponse(evaluation))
      throw new Error(`Unexpected API path: ${url}`)
    })
    vi.stubGlobal('fetch', mocked)
    render(<RentalWorkspace view="analyze" onNavigate={vi.fn()}/>)
    await openLeaseInput()
    fireEvent.change(screen.getByLabelText('Lease provisions'), { target: { value: 'SYNTHETIC LEASE' } })
    fireEvent.click(screen.getByRole('button', { name: 'Extract lease terms' }))
    expect(await screen.findByText("Here's what we found in your lease.")).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/I've checked the rent, lease length/))
    fireEvent.click(screen.getByRole('button', { name: 'See my rental costs' }))
    expect(await screen.findByLabelText('Rental evaluation results')).toBeInTheDocument()
    const confirmBody = JSON.parse(mocked.mock.calls.find(call => String(call[0]).endsWith('/lease/confirm'))![1].body)
    expect(confirmBody.decisions).toHaveLength(3)
    expect(confirmBody.decisions).toEqual(expect.arrayContaining([
      { field_id: 'rental_label', action: 'accept' },
      { field_id: 'monthly_base_rent', action: 'accept' },
      { field_id: 'lease_term_months', action: 'accept' },
    ]))
    expect(JSON.stringify(confirmBody)).not.toContain('SYNTHETIC LEASE')
  })
  it('enters the chosen AI method directly and switches through a compact action', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ configured: true, service_ready: true, model: 'synthetic-test' })))
    render(<RentalWorkspace view="analyze" onNavigate={vi.fn()}/> )
    await openLeaseInput()
    expect(await screen.findByLabelText('Lease document input')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /No lease needed/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Switch to guided analysis' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Switch to guided analysis' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use the detailed manual form instead' }))
    expect(screen.getByLabelText('Manual rental details')).toBeInTheDocument()
    expect(screen.queryByLabelText('Lease provisions')).not.toBeInTheDocument()
  })
})

describe('Batch 6A Analyze workflow', () => {
  it('shows one primary starting path and keeps finances out of the welcome screen', () => {
    render(<RentalWorkspace view="analyze" onNavigate={vi.fn()}/> )
    expect(screen.getByRole('heading', { name: 'Know what your rental will really cost.' })).toBeInTheDocument()
    const primary = screen.getByRole('button', { name: /Start rental analysis/ })
    expect(screen.queryByRole('button', { name: /Analyze lease text with AI/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Try with example data/ })).toBeInTheDocument()
    expect(screen.queryByLabelText('Financial profile')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Manual rental details')).not.toBeInTheDocument()
    primary.focus()
    expect(document.activeElement).toBe(primary)
  })

  it('uses the guided sample to reach a labeled synthetic result and comparison actions', async () => {
    const mocked = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/lease/status')) return Promise.resolve(jsonResponse({ configured: false, service_ready: false, model: 'synthetic-test' }))
      if (url.endsWith('/rental/evaluate')) return Promise.resolve(jsonResponse(evaluation))
      throw new Error(`Unexpected API path: ${url}`)
    })
    vi.stubGlobal('fetch', mocked)
    render(<RentalWorkspace view="analyze" onNavigate={vi.fn()}/> )
    expect(await openSampleResult()).toBeInTheDocument()
    expect(screen.getByText(/Synthetic sample rental/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save as Rental A to compare' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Compare sample rentals' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Can I comfortably afford this rental?' })).toBeInTheDocument()
  })

  it('reveals optional finances, marks old figures stale, and recalculates without losing the rental', async () => {
    const personalized = { ...evaluation, financial_profile: { known_monthly_cash_remaining_after_housing_and_savings: 777, initial_savings_remaining_after_known_move_in_cash: 2400, affordability_status: 'within_budget', emergency_reserve_preserved: true } }
    const mocked = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/lease/status')) return Promise.resolve(jsonResponse({ configured: false, service_ready: false, model: 'synthetic-test' }))
      if (url.endsWith('/rental/evaluate')) return Promise.resolve(jsonResponse(mocked.mock.calls.filter(call => String(call[0]).endsWith('/rental/evaluate')).length > 1 ? personalized : evaluation))
      throw new Error(`Unexpected API path: ${url}`)
    })
    vi.stubGlobal('fetch', mocked)
    render(<RentalWorkspace view="analyze" onNavigate={vi.fn()}/> )
    await openSampleResult()
    fireEvent.click(screen.getByRole('button', { name: 'Add my finances' }))
    fireEvent.change(screen.getByLabelText('Monthly take-home income'), { target: { value: '4500' } })
    fireEvent.change(screen.getByLabelText('Available savings'), { target: { value: '8000' } })
    fireEvent.change(screen.getByLabelText('Essential nonhousing expenses / month'), { target: { value: '1800' } })
    expect(screen.getByText(/financial profile changed/i)).toBeInTheDocument()
    expect(screen.queryByText(/Monthly cash left after expenses and savings target/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Update my finances' }))
    expect(await screen.findByText(/Monthly cash left: \$777/)).toBeInTheDocument()
    expect(screen.getByText(/Synthetic sample rental/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit finances' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit finances' }))
    expect(screen.getByText(/Monthly take-home pay after taxes and payroll deductions/)).toBeInTheDocument()
    expect(screen.getByText(/not a guaranteed payment or reduction in lease responsibility/)).toBeInTheDocument()
  })

  it('keeps advanced manual fields collapsed until requested', () => {
    render(<RentalInput busy={false} onEvaluate={vi.fn()}/> )
    expect(screen.getByLabelText('Advertised monthly rent')).toBeInTheDocument()
    expect(screen.queryByLabelText('Recurring fee list completeness')).not.toBeVisible()
    fireEvent.click(screen.getByText(/Other monthly costs/))
    expect(screen.getByLabelText('Recurring fee list completeness')).toBeVisible()
    expect(screen.getByText(/Additional terms/)).toBeInTheDocument()
  })

  it('collapses cash flow by default and switches from chart to full table', () => {
    render(<RentalResults offer={demoOffers[0]} result={evaluation} onSave={vi.fn()} savedSlot={null}/> )
    const disclosure = screen.getByText(/See your costs month by month/).closest('details')!
    expect(disclosure).not.toHaveAttribute('open')
    fireEvent.click(screen.getByText(/See your costs month by month/))
    expect(screen.getByRole('img', { name: /Monthly household housing costs shown as bars/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Detailed table' }))
    expect(screen.getByRole('table', { name: 'Lease month cash flow' })).toBeInTheDocument()
    expect(screen.getByText('Prepaid rent allocated')).toBeInTheDocument()
  })

  it('preserves pasted lease text when moving back from review to document entry', async () => {
    const mocked = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/lease/status')) return Promise.resolve(jsonResponse({ configured: true, service_ready: true, model: 'synthetic-test' }))
      if (url.endsWith('/lease/extract-text')) return Promise.resolve(jsonResponse(draft))
      throw new Error(`Unexpected API path: ${url}`)
    })
    vi.stubGlobal('fetch', mocked)
    render(<RentalWorkspace view="analyze" onNavigate={vi.fn()}/> )
    await openLeaseInput()
    fireEvent.change(screen.getByLabelText('Lease provisions'), { target: { value: 'SYNTHETIC PRESERVED TEXT' } })
    fireEvent.click(screen.getByRole('button', { name: 'Extract lease terms' }))
    expect(await screen.findByText("Here's what we found in your lease.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back to my lease' }))
    expect(screen.getByLabelText('Lease provisions')).toHaveValue('SYNTHETIC PRESERVED TEXT')
  })

  it('starts a blank manual rental after the sample while preserving the explicitly saved comparison offer', async () => {
    const mocked = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/lease/status')) return Promise.resolve(jsonResponse({ configured: false, service_ready: false, model: 'synthetic-test' }))
      if (url.endsWith('/rental/evaluate')) return Promise.resolve(jsonResponse(evaluation))
      throw new Error(`Unexpected API path: ${url}`)
    })
    vi.stubGlobal('fetch', mocked)
    const onNavigate = vi.fn()
    const view = (selected: ProductView) => <RentalWorkspace view={selected} onNavigate={onNavigate}/>
    const rendered = render(view('analyze'))
    expect(await openSampleResult()).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save as Rental A to compare' }))
    expect(screen.getByText(/Saved to Rental A/)).toHaveAttribute('role', 'status')
    fireEvent.click(screen.getByRole('button', { name: 'Start another' }))
    fireEvent.click(screen.getByRole('button', { name: /Start rental analysis/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Use the detailed manual form instead' }))
    expect(screen.getByLabelText('Rental name')).toHaveValue('')
    expect(screen.getByLabelText('Advertised monthly rent')).toHaveValue(null)
    expect(screen.getByLabelText('Lease length (months; default 12)')).toHaveValue(12)
    expect(screen.getByLabelText('Security deposit')).toHaveValue('unknown')
    expect(screen.getByLabelText('Utilities')).toHaveValue('unknown')
    rendered.rerender(view('compare'))
    expect(screen.getByRole('heading', { name: 'Synthetic sample rental' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'No offer saved yet' })).toBeInTheDocument()
  })

  it('edits an existing offer with its original values intact', () => {
    render(<RentalInput seed={demoOffers[0]} busy={false} onEvaluate={vi.fn()}/> )
    expect(screen.getByLabelText('Rental name')).toHaveValue('Synthetic Scenario A')
    expect(screen.getByLabelText('Advertised monthly rent')).toHaveValue(1450)
    expect(screen.getByLabelText('Security deposit')).toHaveValue('provided')
    fireEvent.click(screen.getByText(/Other monthly costs/))
    expect(screen.getByLabelText('Recurring fee 1 name')).toHaveValue('Parking')
    fireEvent.click(screen.getByText(/Additional terms/))
    expect(screen.getByLabelText('Other upfront charge list completeness')).toHaveValue('complete')
  })

  it('retains detailed manual input behind the guided path', () => {
    render(<RentalWorkspace view="analyze" onNavigate={vi.fn()}/> )
    fireEvent.click(screen.getByRole('button', { name: /Start rental analysis/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Use the detailed manual form instead' }))
    expect(screen.getByLabelText('Manual rental details')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Analyze lease text instead' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /No lease needed/ })).not.toBeInTheDocument()
  })
})

describe('manual completeness and currency', () => {
  it('keeps blank charges unknown until the user confirms each complete list', () => {
    const initial = blankManual()
    expect(initial.label).toBe('')
    expect(initial.rent).toBe('')
    expect(initial.recurring).toEqual([])
    expect(initial.concessions).toEqual([])
    const offer = manualToOffer({ ...initial, label: 'New rental', rent: '1500' })
    expect(offer.recurring_charges_status).toBe('unknown')
    expect(offer.utilities).toEqual({ status: 'unknown' })
    expect(offer.upfront?.security_deposit).toEqual({ status: 'unknown' })
    expect(offer.upfront?.nonrefundable_fees_status).toBe('unknown')
    expect(offer.upfront?.other_charges_status).toBe('unknown')
    expect(offer.upfront?.holding_deposit_status).toBe('unknown')
    expect(offer.upfront?.last_month_rent_due_upfront).toBe('unknown')
    const confirmedNone = manualToOffer({ ...initial, label: 'Reviewed rental', rent: '1500', depositStatus: 'none', utilityStatus: 'included_in_rent', recurringStatus: 'complete', feeStatus: 'complete', otherChargeStatus: 'complete', holdingStatus: 'none', firstPrepaid: 'no', lastPrepaid: 'no' })
    expect(confirmedNone.recurring_charges).toEqual([])
    expect(confirmedNone.recurring_charges_status).toBe('complete')
    expect(confirmedNone.utilities?.status).toBe('included_in_rent')
    expect(confirmedNone.upfront?.security_deposit).toEqual({ status: 'none' })
    expect(confirmedNone.upfront?.other_charges_status).toBe('complete')
    expect(offerToManual(demoOffers[0]).deposit).toBe('2000')
  })

  it('formats whole, fractional, zero, negative, large, and missing currency values safely', () => {
    expect(money(1830)).toBe('$1,830')
    expect(money(1830.75)).toBe('$1,830.75')
    expect(money(0)).toBe('$0')
    expect(money(-12)).toBe('-$12')
    expect(money(1234567890)).toBe('$1,234,567,890')
    expect(money(null)).toBe('Unknown')
    expect(money(undefined)).toBe('Unknown')
    expect(money(Number.NaN)).toBe('Unknown')
    expect(money(1830, true)).toBe('$1,830.00')
  })

  it('renders unknown and confirmed-none as different, nonnumeric states', () => {
    const unknown = manualToOffer({ ...blankManual(), label: 'Unknown fees', rent: '1300' })
    const none = manualToOffer({ ...blankManual(), label: 'No monthly fees', rent: '1300', recurringStatus: 'complete', utilityStatus: 'included_in_rent', depositStatus: 'none', feeStatus: 'complete', otherChargeStatus: 'complete', holdingStatus: 'none' })
    expect(unknown.recurring_charges_status).toBe('unknown')
    expect(unknown.utilities?.status).toBe('unknown')
    expect(unknown.upfront?.security_deposit?.status).toBe('unknown')
    expect(none.recurring_charges).toEqual([])
    expect(none.recurring_charges_status).toBe('complete')
    expect(none.utilities?.status).toBe('included_in_rent')
    expect(none.upfront?.security_deposit?.status).toBe('none')
    expect(none.upfront?.other_charges_status).toBe('complete')
  })
})
