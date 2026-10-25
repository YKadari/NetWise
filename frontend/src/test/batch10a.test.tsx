import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RentalOverview } from '../components/RentalOverview'
import { RentalWorkspace } from '../components/RentalWorkspace'
import { generateRentalDecisionBrief } from '../lib/rentalApi'
import { sampleGuided, guidedToRequest } from '../lib/guidedAdvisor'
import type { RentalDecisionBrief, RentalEvaluation, RentalFollowUpResponse } from '../types/rental'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const offer = guidedToRequest(sampleGuided()).offer
const result: RentalEvaluation = {
  rental_label: offer.rental_label, lease: { term_months: 12 },
  monthly_costs: { base_rent_before_concessions: 1600, gross_known_monthly_housing_obligation: 1770, average_modeled_housing_obligation: 1770, recurring_charges_known_subtotal: 40, utilities_known_subtotal: 130, monthly_costs_complete: false, expected_personal_monthly_share: 1770 },
  upfront: { upfront_cash_required: 2500, upfront_cash_complete: false, refundable_cash_held: 800, potential_deposit_refund_not_guaranteed: 800, unknown_upfront_terms: ['holding_deposit'] },
  lease_totals: { known_modeled_nonrefundable_lease_cost: 21340, nonrefundable_cost_complete: false, known_total_cash_outflows_including_refundable_holds: 22140, cash_outflow_total_complete: false },
  financial_profile: null, month_by_month_cash_flow: [], unknown_cost_categories: ['recurring_charges', 'nonrefundable_fees', 'holding_deposit'], warnings: [], assumptions: [],
}
const followups = ['monthly_fees', 'utilities', 'deposit_return', 'holding_deposit'].map((id, i) => ({ title: `Question ${i + 1}`, why_it_matters: 'This term is uncertain.', question: `Could you clarify item ${i + 1}?`, priority: 'Before move-in', facts: `Verified uncertainty ${id}.` }))
const suggested: RentalFollowUpResponse = { source: 'deterministic', follow_ups: followups.slice(0, 3), additional_follow_ups: followups.slice(3) }
const brief: RentalDecisionBrief = { source: 'gemini', headline: 'Some costs need answers before you commit.', overall_summary: 'Known monthly housing subtotal is $1,770.', important_findings: ['The identified costs exceed advertised rent.'], key_uncertainties: ['Required fees are not confirmed.'], suggested_next_step: 'Request the fee schedule.', fact_ids: ['monthly'], follow_ups: followups.slice(0, 3), additional_follow_ups: followups.slice(3) }
const jsonResponse = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

describe('Batch 10A unified Analyze and optional brief', () => {
  it('shows one guided entry and opens the same four-stage flow with synthetic data', () => {
    render(<RentalWorkspace view="analyze" onNavigate={vi.fn()}/>)
    expect(screen.getByRole('heading', { name: 'Know what your rental will really cost.' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Analyze lease text with AI/ })).not.toBeInTheDocument()
    const start = screen.getByRole('button', { name: 'Start rental analysis' })
    start.focus(); expect(document.activeElement).toBe(start)
    fireEvent.click(screen.getByRole('button', { name: 'Try with example data' }))
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument()
    expect(screen.getByLabelText('Advertised monthly rent for the whole rental ($)')).toHaveValue(1600)
  })

  it('always shows a deterministic overview and hides AI when disabled', () => {
    render(<RentalOverview offer={offer} result={result} status={{ configured: true, model: 'test', service_ready: false }} profileStale={false}/>)
    expect(screen.getByLabelText('Your rental overview')).toHaveTextContent('Known monthly housing subtotal (including estimated utilities): $1,770')
    expect(screen.getByText(/required monthly fees, one-time fees, holding deposit/)).toBeInTheDocument()
    expect(screen.getByText(/is potentially refundable cash held/)).toHaveTextContent('$800')
    expect(screen.queryByRole('button', { name: 'Generate AI insights' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('AI rental insights')).not.toBeInTheDocument()
  })

  it('sends only offer and optional profile after explicit action and renders genuine response', async () => {
    const mocked = vi.fn().mockImplementation((url: string) => Promise.resolve(jsonResponse(url.endsWith('/follow-ups') ? suggested : brief)))
    vi.stubGlobal('fetch', mocked)
    render(<RentalOverview offer={offer} result={result} status={{ configured: true, model: 'test', service_ready: true }} profileStale={false}/>)
    expect(mocked.mock.calls.some(([url]) => String(url).endsWith('/decision-brief'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Generate AI insights' }))
    expect(await screen.findByText(brief.headline)).toBeInTheDocument()
    expect(screen.getByText('AI-prioritized questions')).toBeInTheDocument()
    const [path, options] = mocked.mock.calls.find(([url]) => url.endsWith('/decision-brief'))!
    expect(path).toBe('/api/rental/decision-brief')
    expect(JSON.parse(options.body)).toEqual({ offer })
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })

  it('keeps the overview after a provider failure and suppresses stale AI output', async () => {
    let briefCalls = 0
    const mocked = vi.fn().mockImplementation((url: string) => Promise.resolve(url.endsWith('/follow-ups') ? jsonResponse(suggested) : (++briefCalls === 1 ? jsonResponse(brief) : jsonResponse({ detail: 'private provider exception' }, 502))))
    vi.stubGlobal('fetch', mocked)
    const status = { configured: true, model: 'test', service_ready: true }
    const rendered = render(<RentalOverview offer={offer} result={result} status={status} profileStale={false}/>)
    fireEvent.click(screen.getByRole('button', { name: 'Generate AI insights' }))
    expect(await screen.findByText(brief.headline)).toBeInTheDocument()
    rendered.rerender(<RentalOverview offer={{ ...offer, monthly_base_rent: 1700 }} result={{ ...result, monthly_costs: { ...result.monthly_costs, base_rent_before_concessions: 1700 } }} status={status} profileStale={false}/>)
    expect(screen.queryByText(brief.headline)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Generate AI insights' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('AI insights could not be verified')
    expect(screen.getByLabelText('Your rental overview')).toHaveTextContent('Known move-in cash subtotal: $2,500')
    expect(screen.queryByText('private provider exception')).not.toBeInTheDocument()
  })

  it('hides insights when the financial profile has changed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => Promise.resolve(jsonResponse(url.endsWith('/follow-ups') ? suggested : brief))))
    const status = { configured: true, model: 'test', service_ready: true }
    const rendered = render(<RentalOverview offer={offer} result={result} status={status} profileStale={false}/>)
    fireEvent.click(screen.getByRole('button', { name: 'Generate AI insights' }))
    await screen.findByText(brief.headline)
    rendered.rerender(<RentalOverview offer={offer} result={result} status={status} profileStale/>)
    expect(screen.queryByText(brief.headline)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generate AI insights' })).not.toBeInTheDocument()
    expect(screen.getAllByText(/Refresh the financial results/).length).toBeGreaterThan(0)
  })

  it('does not accept an incomplete AI response from the client API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ headline: 'Made up' })))
    await expect(generateRentalDecisionBrief(offer)).rejects.toThrow(/could not be verified/)
  })

  it('shows grounded deterministic questions, copy controls, accessible status, and extra questions', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(suggested)))
    render(<RentalOverview offer={offer} result={result} status={{ configured: false, model: 'test', service_ready: false }} profileStale={false}/> )
    const section = await screen.findByLabelText('Before you sign')
    expect(section).toHaveTextContent('Suggested questions')
    expect(within(within(section).getAllByRole('list')[0]).getAllByRole('listitem')).toHaveLength(3)
    expect(within(section).getByText(/Could you clarify item 1/)).toBeInTheDocument()
    const copy = within(section).getAllByRole('button', { name: 'Copy question' })[0]
    copy.focus(); expect(document.activeElement).toBe(copy)
    fireEvent.click(copy)
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Could you clarify item 1?'))
    expect(await within(section).findByRole('status')).toHaveTextContent('Question copied.')
    fireEvent.click(within(section).getByText('See all questions (4)'))
    expect(within(section).getByText(/Could you clarify item 4/)).toBeInTheDocument()
    fireEvent.click(within(section).getByRole('button', { name: 'Copy all questions' }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('Questions about this rental:')))
  })

  it('keeps deterministic questions if AI fails and labels successful rankings as AI-prioritized', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => Promise.resolve(url.endsWith('/follow-ups') ? jsonResponse(suggested) : jsonResponse({ detail: 'safe failure' }, 502))))
    render(<RentalOverview offer={offer} result={result} status={{ configured: true, model: 'test', service_ready: true }} profileStale={false}/> )
    expect(await screen.findByText(/Could you clarify item 1/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Generate AI insights' }))
    expect(await screen.findByText(/AI prioritization did not load/)).toBeInTheDocument()
    expect(screen.getByText(/Could you clarify item 1/)).toBeInTheDocument()
  })

  it('shows fewer than three questions when only two candidates are eligible', async () => {
    const two = { source: 'deterministic', follow_ups: followups.slice(0, 2), additional_follow_ups: [] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(two)))
    render(<RentalOverview offer={offer} result={result} status={{ configured: false, model: 'test', service_ready: false }} profileStale={false}/> )
    const section = await screen.findByLabelText('Before you sign')
    expect(within(within(section).getAllByRole('list')[0]).getAllByRole('listitem')).toHaveLength(2)
  })

  it('invalidates pending fallback questions when the evaluated offer changes', async () => {
    const resolvers: Array<(value: ReturnType<typeof jsonResponse>) => void> = []
    const mocked = vi.fn().mockImplementation((_url: string) => new Promise(resolve => { resolvers.push(resolve) }))
    vi.stubGlobal('fetch', mocked)
    const status = { configured: false, model: 'test', service_ready: false }
    const rendered = render(<RentalOverview offer={offer} result={result} status={status} profileStale={false}/> )
    rendered.rerender(<RentalOverview offer={{ ...offer, monthly_base_rent: 1700 }} result={{ ...result, monthly_costs: { ...result.monthly_costs, base_rent_before_concessions: 1700 } }} status={status} profileStale={false}/> )
    resolvers[0](jsonResponse({ ...suggested, follow_ups: [{ ...followups[0], question: 'STALE QUESTION' }] }))
    await waitFor(() => expect(screen.queryByText('STALE QUESTION')).not.toBeInTheDocument())
    expect(await screen.findByText('Updating suggested questions…')).toBeInTheDocument()
  })

  it('reaches existing results, comparison, and stress controls through the guided sample', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => Promise.resolve(jsonResponse(url.endsWith('/lease/status') ? { configured: false, model: 'test', service_ready: false } : result))))
    render(<RentalWorkspace view="analyze" onNavigate={vi.fn()}/>)
    fireEvent.click(screen.getByRole('button', { name: 'Try with example data' }))
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'See my rental costs' }))
    await waitFor(() => expect(screen.getByLabelText('Rental evaluation results')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Save as Rental A to compare' })).toBeInTheDocument()
    expect(screen.getByText(/What if things don't go according to plan/)).toBeInTheDocument()
    expect(screen.getByLabelText('Your rental overview')).toBeInTheDocument()
    expect(screen.getAllByLabelText('Before you sign')).toHaveLength(1)
  })
})
