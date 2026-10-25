import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { GuidedAdvisor } from '../components/GuidedAdvisor'
import { RentalWorkspace } from '../components/RentalWorkspace'
import { blankGuided, guidedQuestions, guidedToRequest, sampleGuided } from '../lib/guidedAdvisor'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const unavailable = { configured: false, model: 'test', service_ready: false }
const sample = sampleGuided()

describe('Batch 9 mapping to the existing evaluator', () => {
  it('keeps the synthetic known costs and unknown fee lists distinct', () => {
    const { offer, profile } = guidedToRequest(sample)
    expect(profile).toBeUndefined()
    expect(offer.monthly_base_rent).toBe(1600)
    expect(offer.lease_term_months).toBe(12)
    expect(offer.upfront?.security_deposit).toEqual({ status: 'provided', amount: 800 })
    expect(offer.upfront?.first_month_rent_due_upfront).toBe('yes')
    expect(offer.upfront?.last_month_rent_due_upfront).toBe('no')
    expect(offer.upfront?.nonrefundable_fees).toEqual([{ name: 'Application fee', amount: 100 }])
    expect(offer.upfront?.nonrefundable_fees_status).toBe('unknown')
    expect(offer.recurring_charges).toEqual([{ name: 'Internet', monthly_amount: 40 }])
    expect(offer.recurring_charges_status).toBe('unknown')
    expect(offer.utilities).toEqual({ status: 'estimated', estimated_monthly_amount: 130 })
    expect(guidedQuestions(sample)).toEqual(expect.arrayContaining([expect.stringMatching(/administration fees/), expect.stringMatching(/mandatory service fees/), expect.stringMatching(/end the lease early/)]))
  })
  it('distinguishes absence, uncertainty, nonrefundable payments, and known holding treatment', () => {
    const d = { ...blankGuided(), rent: '1600.25', deposit: 'yes' as const, depositAmount: '800', depositTreatment: 'nonrefundable' as const, holding: 'yes' as const, holdingAmount: '200', holdingTreatment: 'credited_to_first_month_rent' as const, utilities: 'included' as const, application: 'no' as const, administration: 'no' as const, mandatory: 'no' as const, otherMonthly: 'no' as const, internet: 'included' as const, otherUpfront: 'no' as const }
    const offer = guidedToRequest(d).offer
    expect(offer.upfront?.security_deposit).toEqual({ status: 'none' })
    expect(offer.upfront?.nonrefundable_fees).toEqual([{ name: 'Nonrefundable deposit', amount: 800 }])
    expect(offer.upfront?.holding_deposit).toEqual({ amount: 200, treatment: 'credited_to_first_month_rent' })
    expect(offer.upfront?.holding_deposit_status).toBe('provided')
    expect(offer.utilities).toEqual({ status: 'included_in_rent' })
    expect(offer.recurring_charges_status).toBe('complete')
    expect(guidedToRequest({ ...d, depositTreatment: 'unknown' }).offer.upfront?.security_deposit).toEqual({ status: 'unknown' })
  })
  it('uses only the entered roommate contribution and stated concession', () => {
    const d = { ...sample, sharing: 'yes' as const, roommate: '650', discount: 'credit' as const, discountMonth: '2', discountAmount: '100', finance: true, income: '4000', savings: '5000', essentials: '1200' }
    const { offer, profile } = guidedToRequest(d)
    expect(offer.monthly_base_rent).toBe(1600)
    expect(offer.expected_roommate_contribution).toEqual({ status: 'provided', amount: 650 })
    expect(offer.concessions).toEqual([{ kind: 'rent_credit', month: 2, amount: 100 }])
    expect(profile).toEqual({ monthly_take_home_income: 4000, available_savings: 5000, essential_monthly_nonhousing_expenses: 1200, student_loan_included_in_essential_expenses: true })
    expect(guidedToRequest({ ...d, finance: false }).profile).toBeUndefined()
    expect(guidedToRequest({ ...d, discount: 'free_month', discountMonth: '3' }).offer.concessions).toEqual([{ kind: 'free_rent_month', month: 3 }])
  })
  it('rejects invalid monetary and concession values', () => {
    expect(() => guidedToRequest({ ...sample, rent: '0' })).toThrow()
    expect(() => guidedToRequest({ ...sample, internetAmount: '40.123' })).toThrow()
    expect(() => guidedToRequest({ ...sample, discount: 'credit', discountMonth: '13', discountAmount: '100' })).toThrow()
    expect(() => guidedToRequest({ ...sample, sharing: 'yes', roommate: '1700' })).toThrow(/cannot exceed/)
  })
  it('reconciles dependent answers without sending hidden stale charges', () => {
    const d = { ...sample, internet: 'included' as const, internetAmount: '40', utilities: 'included' as const, utilitiesAmount: '130', deposit: 'no' as const, depositAmount: '800', parkingRelevant: false, parking: 'required' as const, parkingAmount: '200', sharing: 'no' as const, roommate: '500' }
    const offer = guidedToRequest(d).offer
    expect(offer.recurring_charges).toEqual([])
    expect(offer.utilities).toEqual({ status: 'included_in_rent' })
    expect(offer.upfront?.security_deposit).toEqual({ status: 'none' })
    expect(offer.expected_roommate_contribution).toEqual({ status: 'none' })
  })
  it('keeps unclear payment treatment unknown rather than inserting a guessed amount', () => {
    const d = { ...sample, depositTreatment: 'unknown' as const, holding: 'yes' as const, holdingAmount: '200', holdingTreatment: 'unknown' as const, otherUpfront: 'yes' as const, otherUpfrontAmount: '300', otherUpfrontName: 'Key payment', otherUpfrontTreatment: 'unknown' as const }
    const offer = guidedToRequest(d).offer
    expect(offer.upfront?.security_deposit?.status).toBe('unknown')
    expect(offer.upfront?.holding_deposit_status).toBe('unknown')
    expect(offer.upfront?.holding_deposit).toBeUndefined()
    expect(offer.upfront?.other_charges_status).toBe('unknown')
    expect(offer.upfront?.other_charges).toEqual([])
  })
})

describe('Batch 9 guided flow', () => {
  it('navigates backward with answers intact and hides conditional inputs', () => {
    render(<GuidedAdvisor busy={false} status={unavailable} onEvaluate={vi.fn()}/>)
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Advertised monthly rent for the whole rental ($)'), { target: { value: '1600' } })
    fireEvent.click(screen.getByLabelText('Yes, sharing rent'))
    expect(screen.getByLabelText('Expected monthly payment from roommate(s) toward housing ($)')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Expected monthly payment from roommate(s) toward housing ($)'), { target: { value: '700' } })
    fireEvent.click(screen.getByLabelText('No, renting alone'))
    expect(screen.queryByLabelText('Expected monthly payment from roommate(s) toward housing ($)')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText('Step 2 of 4')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByLabelText('Advertised monthly rent for the whole rental ($)')).toHaveValue(1600)
    expect(screen.queryByLabelText('Expected monthly payment from roommate(s) toward housing ($)')).not.toBeInTheDocument()
  })
  it('submits the sample through the evaluator with no profile and exposes AI-disabled help', () => {
    const onEvaluate = vi.fn()
    render(<GuidedAdvisor initial={sample} busy={false} status={unavailable} onEvaluate={onEvaluate}/>)
    for (let n = 1; n <= 3; n++) { fireEvent.click(screen.getByRole('button', { name: 'Continue' })); expect(screen.getByText(`Step ${n + 1} of 4`)).toBeInTheDocument(); if (n === 1) expect(screen.getByText(/Live AI analysis is unavailable here/)).toBeInTheDocument() }
    expect(screen.getByRole('button', { name: 'See my rental costs' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'See my rental costs' }))
    expect(onEvaluate).toHaveBeenCalledOnce()
    expect(onEvaluate.mock.calls[0][0].monthly_base_rent).toBe(1600)
    expect(onEvaluate.mock.calls[0][1]).toBeUndefined()
  })
  it('opens the primary guided path and keeps PDF hidden from the optional text path', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => unavailable }))
    render(<RentalWorkspace view="analyze" onNavigate={vi.fn()}/>)
    const primary = screen.getByRole('button', { name: /Start guided analysis/ })
    primary.focus(); expect(document.activeElement).toBe(primary)
    fireEvent.click(screen.getByRole('button', { name: /Analyze lease text with AI/ }))
    await waitFor(() => expect(screen.getByText(/Live AI lease extraction is temporarily unavailable/)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Upload PDF' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Switch to guided analysis' }))
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument()
  })
  it('sends the guided sample to the existing evaluator and renders uncertain results and questions', async () => {
    const evaluation = {
      rental_label: 'Synthetic sample rental', lease: { term_months: 12 },
      monthly_costs: { base_rent_before_concessions: 1600, gross_known_monthly_housing_obligation: 1770, average_modeled_housing_obligation: 1770, recurring_charges_known_subtotal: 40, utilities_known_subtotal: 130, monthly_costs_complete: false, expected_personal_monthly_share: 1770 },
      upfront: { upfront_cash_required: 2500, upfront_cash_complete: false, refundable_cash_held: 800, potential_deposit_refund_not_guaranteed: 800, unknown_upfront_terms: ['administration_fee'] },
      lease_totals: { known_modeled_nonrefundable_lease_cost: 21340, nonrefundable_cost_complete: false, known_total_cash_outflows_including_refundable_holds: 22140, cash_outflow_total_complete: false },
      financial_profile: null, month_by_month_cash_flow: [], unknown_cost_categories: ['recurring_charges', 'nonrefundable_fees'], warnings: [], assumptions: [],
    }
    const mocked = vi.fn().mockImplementation((url: string) => Promise.resolve({ ok: true, status: 200, json: async () => url.endsWith('/lease/status') ? unavailable : evaluation }))
    vi.stubGlobal('fetch', mocked)
    render(<RentalWorkspace view="analyze" onNavigate={vi.fn()}/>)
    fireEvent.click(screen.getByRole('button', { name: /Try a sample rental/ }))
    for (let n = 0; n < 3; n++) fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'See my rental costs' }))
    expect(await screen.findByLabelText('Rental evaluation results')).toBeInTheDocument()
    expect(screen.getByText('Known monthly subtotal')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Questions to ask before signing' })).toBeInTheDocument()
    const sent = JSON.parse(mocked.mock.calls.find(call => String(call[0]).endsWith('/rental/evaluate'))![1].body)
    expect(sent.offer.monthly_base_rent).toBe(1600)
    expect(sent.offer.upfront.security_deposit).toEqual({ status: 'provided', amount: 800 })
    expect(sent.offer.upfront.first_month_rent_due_upfront).toBe('yes')
    expect(sent.offer.recurring_charges_status).toBe('unknown')
    expect(sent.financial_profile).toBeUndefined()
    fireEvent.click(screen.getByRole('button', { name: 'Edit rental' }))
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument()
    expect(screen.getByLabelText('Advertised monthly rent for the whole rental ($)')).toHaveValue(1600)
  })
})
