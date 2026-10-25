import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LeaseReview } from '../components/LeaseReview'
import { LeaseInput } from '../components/LeaseInput'
import { extractLeasePdf } from '../lib/rentalApi'
import { buildReviewDecisions, initialReviewSummary } from '../lib/leaseReview'
import type { CandidateTerm, LeaseDraft, LeaseFieldId } from '../types/rental'

const term = (field_id: LeaseFieldId, value: unknown, overrides: Partial<CandidateTerm> = {}): CandidateTerm => ({ field_id, value, status: 'explicit', source_excerpt: 'Synthetic lease provision.', page_reference: 1, uncertainty_note: null, evidence_verification: 'verified_page', review_state: 'needs_review', ...overrides })
const base = [term('rental_label', 'Sample Home'), term('monthly_base_rent', 1500), term('lease_term_months', 12)]
const draft = (terms: CandidateTerm[]): LeaseDraft => ({ draft_id: 'synthetic', terms: [...base, ...terms], source_type: 'pdf', review_required: true, general_warnings: [] })
const check = () => fireEvent.click(screen.getByLabelText("I've checked the rent, lease length, and costs shown."))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Batch 8 readable review', () => {
  it('keeps source evidence and legal terms collapsed with focusable disclosure controls', () => {
    render(<LeaseReview draft={draft([term('early_termination', 'Two months notice.')])} busy={false} error={null} onBack={vi.fn()} onConfirm={vi.fn()}/>)
    expect(screen.getByText(/Two months notice/)).not.toBeVisible()
    const source = screen.getAllByText('View source')[0]
    source.focus()
    expect(source).toHaveFocus()
    const disclosure = source.closest('details')!
    const evidence = within(disclosure).getByText(/Matched to text on this PDF page/)
    expect(evidence).not.toBeVisible()
    fireEvent.click(source)
    expect(evidence).toBeVisible()
    expect(screen.getByLabelText('Questions worth asking')).toBeVisible()
    expect(screen.getByRole('button', { name: 'See my rental costs' })).toBeDisabled()
  })

  it('shows named costs and estimates without accepting fee completeness or hidden terms', () => {
    const source = draft([
      term('recurring_charges', [{ name: 'Internet', monthly_amount: 40 }]),
      term('recurring_charges_status', 'complete'),
      term('nonrefundable_fees', [{ name: 'Application fee', amount: 75 }]),
      term('utilities', { status: 'estimated', amount: 130 }),
      term('other_charges', [{ name: 'Pet deposit', amount: 250, refundable: true }]),
      term('concessions', [{ kind: 'rent_credit', month: 1, amount: 100 }]),
      term('early_termination', 'AI suggested clause.', { evidence_verification: 'unverified' }),
    ])
    const onConfirm = vi.fn()
    render(<LeaseReview draft={source} busy={false} error={null} onBack={vi.fn()} onConfirm={onConfirm}/>)
    expect(screen.getByText(/Internet — \$40/)).toBeVisible()
    expect(screen.getByText(/Application fee — \$75/)).toBeVisible()
    expect(screen.getByText(/Pet deposit — \$250 \(refundable\)/)).toBeVisible()
    expect(screen.getByText(/Estimate only/)).toBeVisible()
    expect(screen.queryByText('Monthly fee list')).not.toBeInTheDocument()
    check()
    fireEvent.click(screen.getByRole('button', { name: 'See my rental costs' }))
    const decisions = onConfirm.mock.calls[0][0]
    expect(decisions).toHaveLength(source.terms.length)
    expect(decisions).toContainEqual({ field_id: 'recurring_charges', action: 'accept' })
    for (const field_id of ['recurring_charges_status', 'concessions', 'early_termination']) expect(decisions).toContainEqual({ field_id, action: 'mark_unknown' })
  })

  it('requires a separate deliberate action for complete fee schedules', () => {
    const onConfirm = vi.fn()
    render(<LeaseReview draft={draft([term('recurring_charges', [])])} busy={false} error={null} onBack={vi.fn()} onConfirm={onConfirm}/>)
    fireEvent.click(screen.getByText("I've checked whether other fees apply"))
    fireEvent.click(screen.getByLabelText("I've checked all monthly fees."))
    check()
    fireEvent.click(screen.getByRole('button', { name: 'See my rental costs' }))
    expect(onConfirm.mock.calls[0][0]).toContainEqual({ field_id: 'recurring_charges_status', action: 'confirm_none' })
    expect(onConfirm.mock.calls[0][0]).not.toContainEqual({ field_id: 'nonrefundable_fees_status', action: 'confirm_none' })
  })

  it('edits fees using labeled inputs, preserves edits on reopening, and requires rechecking', () => {
    const source = draft([term('recurring_charges', [{ name: 'Internet', monthly_amount: 40 }])])
    const original = JSON.stringify(source)
    const onConfirm = vi.fn()
    render(<LeaseReview draft={source} busy={false} error={null} onBack={vi.fn()} onConfirm={onConfirm}/>)
    check()
    fireEvent.click(screen.getByRole('button', { name: 'Edit monthly fees identified' }))
    fireEvent.change(screen.getByLabelText('Fee amount 1'), { target: { value: '55' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save corrected charges' }))
    expect(screen.getByRole('button', { name: 'See my rental costs' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Edit monthly fees identified' }))
    expect(screen.getByLabelText('Fee amount 1')).toHaveValue(55)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel edit' }))
    check()
    fireEvent.click(screen.getByRole('button', { name: 'See my rental costs' }))
    expect(onConfirm.mock.calls[0][0]).toContainEqual({ field_id: 'recurring_charges', action: 'correct', value: [{ name: 'Internet', monthly_amount: 55 }] })
    expect(JSON.stringify(source)).toBe(original)
  })

  it('keeps ambiguous, optional, and unspecified refund amounts out of bulk confirmation', () => {
    const source = draft([
      term('security_deposit', null, { status: 'contradictory' }),
      term('recurring_charges', [{ name: 'Optional parking', monthly_amount: 100, optional: true }]),
      term('other_charges', [{ name: 'Deposit', amount: 200 }]),
    ])
    const decisions = buildReviewDecisions(source, { ...initialReviewSummary(source), checked: true })
    for (const field_id of ['security_deposit', 'recurring_charges', 'other_charges']) expect(decisions).toContainEqual({ field_id, action: 'mark_unknown' })
    render(<LeaseReview draft={source} busy={false} error={null} onBack={vi.fn()} onConfirm={vi.fn()}/>)
    expect(screen.getByText(/Conflicting wording/)).toBeVisible()
    expect(screen.getAllByText(/need correction before/)).toHaveLength(2)
    expect(screen.getByText(/Refund terms are not separately confirmed/)).toBeVisible()
  })

  it('offers pasted text and manual entry after a PDF timeout without creating terms', () => {
    const onText = vi.fn(), onPdf = vi.fn(), onManual = vi.fn()
    render(<LeaseInput initialMethod="pdf" busy={false} status={{ configured: true, service_ready: true, model: 'synthetic' }} error="The document service took too long to respond." onText={onText} onPdf={onPdf} onManual={onManual}/>)
    fireEvent.click(screen.getByRole('button', { name: 'Paste text instead' }))
    expect(screen.getByLabelText('Lease provisions')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Enter terms manually' }))
    expect(onManual).toHaveBeenCalledOnce()
    expect(onText).not.toHaveBeenCalled()
    expect(onPdf).not.toHaveBeenCalled()
  })

  it('sends PDF bytes as multipart and reports a useful timeout fallback', async () => {
    const source = draft([])
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(source), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'internal timeout' }), { status: 504 })).mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'private PDF parser message' }), { status: 422 }))
    vi.stubGlobal('fetch', fetchMock)
    const file = new File(['%PDF-synthetic'], 'sample.pdf', { type: 'application/pdf' })
    expect(await extractLeasePdf(file)).toEqual(source)
    const request = fetchMock.mock.calls[0][1] as RequestInit
    expect((request.body as FormData).get('file')).toBe(file)
    expect(request.headers).toBeUndefined()
    await expect(extractLeasePdf(file)).rejects.toThrow(/paste the lease text instead/)
    await expect(extractLeasePdf(file)).rejects.toThrow(/could not read that PDF/)
  })
})
