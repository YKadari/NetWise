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
import { demoOffers, manualToOffer, blankManual, profileToRequest, blankProfile } from '../lib/rentalForms'
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
    fireEvent.change(screen.getByLabelText('Rental label'), { target: { value: 'Synthetic studio' } })
    fireEvent.change(screen.getByLabelText('Advertised base rent / month'), { target: { value: '1200' } })
    fireEvent.click(screen.getByRole('button', { name: 'Evaluate rental offer' }))
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
  it('requires one decision for every extracted term, supports correction, and labels unverified evidence', () => {
    const onConfirm = vi.fn()
    render(<LeaseReview draft={{ ...draft, terms: [...draft.terms, { field_id: 'security_deposit', value: null, source_excerpt: null, page_reference: null, status: 'not_found', uncertainty_note: 'Not found', evidence_verification: 'missing', review_state: 'needs_review' }] }} busy={false} error={null} onConfirm={onConfirm} onBack={vi.fn()}/>)
    expect(screen.getByText('4 of 4 fields still need a decision')).toBeInTheDocument()
    expect(screen.getAllByText(/Evidence: unverified/)).toHaveLength(3)
    const controls = screen.getAllByLabelText('Your review action')
    fireEvent.change(controls[0], { target: { value: 'accept' } })
    fireEvent.change(controls[1], { target: { value: 'correct' } })
    fireEvent.change(screen.getByLabelText('Corrected value'), { target: { value: '1550' } })
    fireEvent.change(controls[2], { target: { value: 'accept' } })
    fireEvent.change(controls[3], { target: { value: 'mark_unknown' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reviewed terms' }))
    expect(onConfirm).toHaveBeenCalledWith(expect.arrayContaining([{ field_id: 'monthly_base_rent', action: 'correct', value: 1550 }, { field_id: 'security_deposit', action: 'mark_unknown' }]))
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
})

describe('financial results, stress, and comparison', () => {
  it('labels incomplete cost figures as known subtotals', () => {
    render(<RentalResults offer={demoOffers[0]} result={{ ...evaluation, monthly_costs: { ...evaluation.monthly_costs, monthly_costs_complete: false }, unknown_cost_categories: ['utilities'] }} onSave={vi.fn()} savedSlot={null}/>)
    expect(screen.getByText('Known monthly subtotal')).toBeInTheDocument()
    expect(screen.getByText(/Unknown categories: utilities/)).toBeInTheDocument()
    expect(screen.getByText('Refundable cash held')).toBeInTheDocument()
  })
  it('submits utility and early-departure scenarios with explicit assumptions', () => {
    const onRun = vi.fn<(scenario: StressScenario) => void>()
    render(<RentalStressPanel offer={demoOffers[0]} busy={false} error={null} result={null} onRun={onRun}/>)
    fireEvent.click(screen.getByRole('button', { name: 'Run scenario' }))
    expect(onRun).toHaveBeenCalledWith({ type: 'utility_increase', additional_monthly_amount: 100, first_affected_month: 1, last_affected_month: 12 })
    fireEvent.change(screen.getByLabelText('Scenario'), { target: { value: 'early_departure' } })
    fireEvent.change(screen.getByLabelText('Treatment'), { target: { value: 'hypothetical_settlement' } })
    fireEvent.change(screen.getByLabelText('Hypothetical fee'), { target: { value: '2000' } })
    fireEvent.change(screen.getByLabelText('Assumption or source note'), { target: { value: 'Synthetic only' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run scenario' }))
    expect(onRun).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'early_departure', departure_month: 8, treatment: 'hypothetical_settlement', termination_fee: 2000, remaining_rent_treatment: 'unknown' }))
  })
  it('compares two saved offers using the API response and flags unequal terms', async () => {
    const result = { left: evaluation, right: { ...evaluation, rental_label: 'Synthetic B' }, differences: { left_minus_right: { base_rent_per_month: -150 }, lease_terms_differ: true, total_period_costs_directly_comparable: false, unknown_cost_categories: { left: [], right: [] } }, comparison_notes: ['Lease durations differ.'], method: 'Shared profile.' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(result)))
    render(<RentalComparison a={demoOffers[0]} b={demoOffers[1]} onEdit={vi.fn()} onDemo={vi.fn()}/>)
    fireEvent.click(screen.getByRole('button', { name: 'Compare the offers' }))
    expect(await screen.findByText(/Lease lengths differ/)).toBeInTheDocument()
    expect(within(screen.getByLabelText('Rental comparison results')).getByText('Measured differences')).toBeInTheDocument()
  })
  it('does not show an old comparison after either selected offer changes', async () => {
    let resolveResponse: ((value: ReturnType<typeof jsonResponse>) => void) | undefined
    const mocked = vi.fn(() => new Promise<ReturnType<typeof jsonResponse>>(resolve => { resolveResponse = resolve }))
    vi.stubGlobal('fetch', mocked)
    const first = render(<RentalComparison a={demoOffers[0]} b={demoOffers[1]} onEdit={vi.fn()} onDemo={vi.fn()}/> )
    fireEvent.click(screen.getByRole('button', { name: 'Compare the offers' }))
    first.rerender(<RentalComparison a={{ ...demoOffers[0], rental_label: 'Replacement A' }} b={demoOffers[1]} onEdit={vi.fn()} onDemo={vi.fn()}/> )
    resolveResponse?.(jsonResponse({ left: evaluation, right: evaluation, differences: { left_minus_right: {}, lease_terms_differ: false, total_period_costs_directly_comparable: true, unknown_cost_categories: { left: [], right: [] } }, comparison_notes: [], method: 'Synthetic.' }))
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
    fireEvent.click(screen.getByRole('button', { name: /Paste lease text Extract then review/ }))
    fireEvent.change(screen.getByLabelText('Lease provisions'), { target: { value: 'SYNTHETIC LEASE' } })
    fireEvent.click(screen.getByRole('button', { name: 'Extract lease terms' }))
    expect(await screen.findByText('Review each extracted field')).toBeInTheDocument()
    screen.getAllByLabelText('Your review action').forEach(control => fireEvent.change(control, { target: { value: 'accept' } }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reviewed terms' }))
    expect(await screen.findByLabelText('Rental evaluation results')).toBeInTheDocument()
    const confirmBody = JSON.parse(mocked.mock.calls.find(call => String(call[0]).endsWith('/lease/confirm'))![1].body)
    expect(confirmBody.decisions).toHaveLength(3)
    expect(JSON.stringify(confirmBody)).not.toContain('SYNTHETIC LEASE')
  })
})
