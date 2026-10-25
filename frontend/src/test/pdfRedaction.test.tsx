import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PdfRedactionWorkspace } from '../components/PdfRedactionWorkspace'

const inspection = {
  document_digest: 'a'.repeat(64),
  page_count: 1,
  warning: 'Automatic detection may miss personal information.',
  pages: [{ page_number: 1, width: 612, height: 792, image_data_url: 'data:image/jpeg;base64,AA==' }],
  candidates: [{ id: 'region-0001', page_number: 1, bbox: [10, 20, 80, 30] as [number, number, number, number], category: 'email', label: 'Email address', review_required: true as const }],
}

afterEach(() => vi.unstubAllGlobals())

describe('privacy-first PDF redaction workflow', () => {
  it('inspects, exposes keyboard-accessible approval, exports, previews, and downloads verified output', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => inspection })
      .mockResolvedValueOnce({ ok: true, headers: { get: (name: string) => name === 'content-type' ? 'application/pdf' : 'b'.repeat(64) }, blob: async () => new Blob(['verified PDF'], { type: 'application/pdf' }) })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:verified-pdf'), revokeObjectURL: vi.fn() })
    render(<PdfRedactionWorkspace onBack={vi.fn()} />)
    const input = screen.getByLabelText(/Choose a text-based PDF/i)
    fireEvent.change(input, { target: { files: [new File(['synthetic'], 'lease.pdf', { type: 'application/pdf' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Inspect PDF' }))
    const checkbox = await screen.findByRole('checkbox', { name: /Email address.*Page 1/i })
    checkbox.focus()
    fireEvent.keyDown(checkbox, { key: ' ' })
    fireEvent.click(checkbox)
    expect(checkbox).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: /Create redacted PDF \(1 approved\)/i }))
    expect(await screen.findByTitle('Preview of verified redacted PDF')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Download redacted PDF' })).toHaveAttribute('download', 'nestwise-redacted.pdf')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/pdf-redaction/inspect')
    expect(fetchMock.mock.calls[1][0]).toBe('/api/pdf-redaction/export')
    const exportOptions = fetchMock.mock.calls[1][1] as RequestInit
    expect(exportOptions.body).toBeInstanceOf(FormData)
    expect((exportOptions.body as FormData).get('document_digest')).toBe('a'.repeat(64))
    expect((exportOptions.body as FormData).get('candidate_ids')).toBe('region-0001')
  })

  it('keeps errors visible and resets proposals when a different document is chosen', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ detail: 'Scanned or image-only PDFs are not supported' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => inspection })
    vi.stubGlobal('fetch', fetchMock)
    render(<PdfRedactionWorkspace onBack={vi.fn()} />)
    const input = screen.getByLabelText(/Choose a text-based PDF/i)
    fireEvent.change(input, { target: { files: [new File(['first'], 'one.pdf', { type: 'application/pdf' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Inspect PDF' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Scanned or image-only PDFs are not supported')
    fireEvent.change(input, { target: { files: [new File(['second'], 'two.pdf', { type: 'application/pdf' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Inspect PDF' }))
    expect(await screen.findByRole('checkbox', { name: /Email address.*Page 1/i })).not.toBeChecked()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
