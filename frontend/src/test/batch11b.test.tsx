import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PdfRedactionWorkspace } from '../components/PdfRedactionWorkspace'
import { RentalWorkspace } from '../components/RentalWorkspace'
import type { LeaseDraft } from '../types/rental'

const ready = { configured: true, service_ready: true, model: 'synthetic-model' }
const inspection = {
  document_digest: 'a'.repeat(64), page_count: 1, warning: 'Automatic detection may miss private information.',
  pages: [{ page_number: 1, width: 612, height: 792, image_data_url: 'data:image/jpeg;base64,AA==' }],
  candidates: [{ id: 'region-0001', page_number: 1, bbox: [10, 20, 80, 30], category: 'email', label: 'Email address', review_required: true }],
}
const draft: LeaseDraft = { draft_id: 'verified-source-draft', source_type: 'pdf', review_required: true, general_warnings: [], terms: [
  { field_id: 'rental_label', value: 'Synthetic rental', status: 'explicit', source_excerpt: 'Rental name: Synthetic rental', page_reference: 1, uncertainty_note: null, evidence_verification: 'verified_page', review_state: 'needs_review' },
  { field_id: 'monthly_base_rent', value: 1600, status: 'explicit', source_excerpt: 'Monthly rent is $1600.', page_reference: 1, uncertainty_note: null, evidence_verification: 'verified_page', review_state: 'needs_review' },
  { field_id: 'lease_term_months', value: 12, status: 'explicit', source_excerpt: '12 months', page_reference: 1, uncertainty_note: null, evidence_verification: 'verified_page', review_state: 'needs_review' },
] }
const jsonResponse = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const exported = () => ({ ok: true, headers: { get: (name: string) => name === 'content-type' ? 'application/pdf' : 'b'.repeat(64) }, blob: async () => new Blob(['verified sanitized bytes'], { type: 'application/pdf' }) })
const consentLabel = /I have reviewed the redacted document.*I agree to send/i

beforeEach(() => {
  const NativeURL = URL
  vi.stubGlobal('URL', class extends NativeURL {
    static createObjectURL = vi.fn(() => 'blob:verified-document')
    static revokeObjectURL = vi.fn()
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function uploadAndInspect() {
  const file = new File(['original synthetic bytes'], 'synthetic.pdf', { type: 'application/pdf' })
  fireEvent.change(screen.getByLabelText(/Choose a text-based PDF/i), { target: { files: [file] } })
  fireEvent.click(screen.getByRole('button', { name: 'Inspect PDF' }))
  await screen.findByRole('heading', { name: 'Proposed redactions' })
  return file
}
async function approveAndExport() {
  const file = await uploadAndInspect()
  fireEvent.click(screen.getByRole('checkbox', { name: /Email address.*Page 1/i }))
  fireEvent.click(screen.getByRole('button', { name: /Create redacted PDF \(1 approved\)/ }))
  await screen.findByRole('link', { name: 'Download redacted PDF' })
  return file
}

describe('Batch 11B approved PDF consent', () => {
  it('requires separate unchecked consent and sends a strict approval record only on explicit analysis', async () => {
    const onExtracted = vi.fn()
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(inspection)).mockResolvedValueOnce(exported()).mockResolvedValueOnce(jsonResponse(draft))
    vi.stubGlobal('fetch', fetchMock)
    render(<PdfRedactionWorkspace status={ready} onBack={vi.fn()} onExtracted={onExtracted} />)
    const file = await approveAndExport()
    const consent = screen.getByRole('checkbox', { name: consentLabel })
    const analyze = screen.getByRole('button', { name: 'Analyze approved PDF with AI' })
    expect(consent).not.toBeChecked()
    expect(analyze).toBeDisabled()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.getByTitle('Preview of verified redacted PDF')).toHaveAttribute('src', 'blob:verified-document')
    consent.focus()
    expect(document.activeElement).toBe(consent)
    fireEvent.click(consent)
    fireEvent.click(analyze)
    await waitFor(() => expect(onExtracted).toHaveBeenCalledWith(draft))
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[2][0]).toBe('/api/lease/extract-redacted-pdf')
    const body = (fetchMock.mock.calls[2][1] as RequestInit).body as FormData
    expect(body.get('file')).toBe(file)
    expect(JSON.parse(body.get('approval') as string)).toEqual({ document_digest: 'a'.repeat(64), approved_pdf_digest: 'b'.repeat(64), candidate_ids: ['region-0001'], consent_to_gemini: true, acknowledge_no_candidates: false })
    expect(body.has('redacted')).toBe(false)
  })

  it.each([429, 502, 503, 504])('preserves the verified preview/download on AI status %s without retrying', async status => {
    const onExtracted = vi.fn()
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(inspection)).mockResolvedValueOnce(exported()).mockResolvedValueOnce(jsonResponse({ detail: 'PRIVATE_PROVIDER_CONTENT' }, status))
    vi.stubGlobal('fetch', fetchMock)
    render(<PdfRedactionWorkspace status={ready} onBack={vi.fn()} onExtracted={onExtracted} />)
    await approveAndExport()
    fireEvent.click(screen.getByRole('checkbox', { name: consentLabel }))
    fireEvent.click(screen.getByRole('button', { name: 'Analyze approved PDF with AI' }))
    expect(await screen.findByRole('alert')).not.toHaveTextContent('PRIVATE_PROVIDER_CONTENT')
    expect(screen.getByRole('link', { name: 'Download redacted PDF' })).toBeVisible()
    expect(screen.getByTitle('Preview of verified redacted PDF')).toBeVisible()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(onExtracted).not.toHaveBeenCalled()
  })

  it('keeps redaction and guided fallback usable while Gemini is unavailable', async () => {
    const onGuided = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse(inspection)).mockResolvedValueOnce(exported()))
    render(<PdfRedactionWorkspace status={{ ...ready, service_ready: false }} onBack={vi.fn()} onGuided={onGuided} onExtracted={vi.fn()} />)
    await approveAndExport()
    expect(screen.queryByRole('button', { name: 'Analyze approved PDF with AI' })).not.toBeInTheDocument()
    expect(screen.getByText(/AI analysis is unavailable on this service/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Continue with guided rental analysis' }))
    expect(onGuided).toHaveBeenCalledOnce()
  })

  it('clears final consent after changing regions or choosing a different PDF', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(inspection)).mockResolvedValueOnce(exported()).mockResolvedValueOnce(exported())
    vi.stubGlobal('fetch', fetchMock)
    render(<PdfRedactionWorkspace status={ready} onBack={vi.fn()} onExtracted={vi.fn()} />)
    await approveAndExport()
    fireEvent.click(screen.getByRole('checkbox', { name: consentLabel }))
    fireEvent.click(screen.getByRole('button', { name: 'Change approved redactions' }))
    expect(screen.queryByRole('checkbox', { name: consentLabel })).not.toBeInTheDocument()
    const region = screen.getByRole('checkbox', { name: /Email address.*Page 1/i })
    fireEvent.click(region)
    expect(screen.getByRole('button', { name: /Create redacted PDF/ })).toBeDisabled()
    fireEvent.click(region)
    fireEvent.click(screen.getByRole('button', { name: /Create redacted PDF/ }))
    expect(await screen.findByRole('checkbox', { name: consentLabel })).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Choose a different PDF' }))
    expect(screen.queryByTitle('Preview of verified redacted PDF')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Choose a text-based PDF/i)).toBeVisible()
  })

  it('requires independent review when no candidates are detected', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ ...inspection, candidates: [], pages: [] })).mockResolvedValueOnce(exported()).mockResolvedValueOnce(jsonResponse(draft))
    vi.stubGlobal('fetch', fetchMock)
    render(<PdfRedactionWorkspace status={ready} onBack={vi.fn()} onExtracted={vi.fn()} />)
    await uploadAndInspect()
    expect(screen.getByRole('button', { name: 'Prepare reviewed PDF' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /independently reviewed this PDF/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Prepare reviewed PDF' }))
    await screen.findByTitle('Preview of verified redacted PDF')
    expect(screen.getByText(/No regions were detected or removed/)).toBeVisible()
    fireEvent.click(screen.getByRole('checkbox', { name: consentLabel }))
    fireEvent.click(screen.getByRole('button', { name: 'Analyze approved PDF with AI' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    const body = (fetchMock.mock.calls[2][1] as RequestInit).body as FormData
    const approval = JSON.parse(body.get('approval') as string)
    expect(approval.acknowledge_no_candidates).toBe(true)
    expect(approval.candidate_ids).toEqual([])
  })

  it('blocks analysis after export verification failure', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(inspection)).mockResolvedValueOnce(jsonResponse({ detail: 'Redaction verification did not pass; no file was returned' }, 422))
    vi.stubGlobal('fetch', fetchMock)
    render(<PdfRedactionWorkspace status={ready} onBack={vi.fn()} onExtracted={vi.fn()} />)
    await uploadAndInspect()
    fireEvent.click(screen.getByRole('checkbox', { name: /Email address.*Page 1/i }))
    fireEvent.click(screen.getByRole('button', { name: /Create redacted PDF/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('verification did not pass')
    expect(screen.queryByRole('button', { name: 'Analyze approved PDF with AI' })).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('suppresses an in-flight AI result if approval is changed', async () => {
    let finish!: (value: unknown) => void
    const onExtracted = vi.fn()
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(inspection)).mockResolvedValueOnce(exported()).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    render(<PdfRedactionWorkspace status={ready} onBack={vi.fn()} onExtracted={onExtracted} />)
    await approveAndExport()
    fireEvent.click(screen.getByRole('checkbox', { name: consentLabel }))
    fireEvent.click(screen.getByRole('button', { name: 'Analyze approved PDF with AI' }))
    expect(screen.getByRole('button', { name: 'Analyzing approved PDF...' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Change approved redactions' }))
    finish(jsonResponse(draft))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Proposed redactions' })).toBeVisible())
    expect(onExtracted).not.toHaveBeenCalled()
  })

  it('opens existing human review and evaluates only after explicit confirmation', async () => {
    const fetchMock = vi.fn(async (path: string) => {
      if (path === '/api/lease/status') return jsonResponse(ready)
      if (path === '/api/pdf-redaction/inspect') return jsonResponse(inspection)
      if (path === '/api/pdf-redaction/export') return exported()
      if (path === '/api/lease/extract-redacted-pdf') return jsonResponse(draft)
      if (path === '/api/lease/confirm') return jsonResponse({ confirmed_offer: { rental_label: 'Synthetic rental', monthly_base_rent: '1600.00', lease_term_months: 12, base_rent_provenance: { source_type: 'document_extracted', reviewed_by_user: true } }, review_history: [], confirmed_clauses: {} })
      if (path === '/api/rental/evaluate') return jsonResponse({ rental_label: 'Synthetic rental', lease: { term_months: 12 }, monthly_costs: { base_rent_before_concessions: 1600, gross_known_monthly_housing_obligation: 1600, average_modeled_housing_obligation: 1600, recurring_charges_known_subtotal: 0, utilities_known_subtotal: 0, monthly_costs_complete: false, expected_personal_monthly_share: 1600 }, upfront: { upfront_cash_required: 0, upfront_cash_complete: false, refundable_cash_held: 0, potential_deposit_refund_not_guaranteed: 0, unknown_upfront_terms: [] }, lease_totals: { known_modeled_nonrefundable_lease_cost: 19200, nonrefundable_cost_complete: false, known_total_cash_outflows_including_refundable_holds: 19200, cash_outflow_total_complete: false }, financial_profile: null, month_by_month_cash_flow: [], unknown_cost_categories: ['utilities'], warnings: [], assumptions: [] })
      if (path === '/api/rental/follow-ups') return jsonResponse({ source: 'deterministic', follow_ups: [], additional_follow_ups: [] })
      throw new Error('Unexpected endpoint')
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<RentalWorkspace view="analyze" onNavigate={vi.fn()} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/lease/status', expect.anything()))
    fireEvent.click(screen.getByRole('button', { name: 'Redact personal information from a lease PDF' }))
    await approveAndExport()
    fireEvent.click(screen.getByRole('checkbox', { name: consentLabel }))
    fireEvent.click(screen.getByRole('button', { name: 'Analyze approved PDF with AI' }))
    const calculate = await screen.findByRole('button', { name: 'See my rental costs' })
    expect(calculate).toBeDisabled()
    expect(fetchMock.mock.calls.some(call => call[0] === '/api/rental/evaluate')).toBe(false)
    fireEvent.click(screen.getByRole('checkbox', { name: "I've checked the rent, lease length, and costs shown." }))
    fireEvent.click(calculate)
    expect(await screen.findByLabelText('Rental evaluation results')).toBeVisible()
    expect(fetchMock.mock.calls.filter(call => call[0] === '/api/lease/confirm')).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(call => call[0] === '/api/rental/evaluate')).toHaveLength(1)
  })
})
