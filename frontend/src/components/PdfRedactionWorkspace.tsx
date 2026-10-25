import { useEffect, useRef, useState } from 'react'
import { exportRedactedPdf, inspectPdfForRedaction, type RedactionInspection } from '../lib/pdfRedaction'
import { extractApprovedPdf } from '../lib/rentalApi'
import type { LeaseDraft, LeaseServiceStatus } from '../types/rental'

interface Props {
  onBack: () => void
  status?: LeaseServiceStatus | null
  onExtracted?: (draft: LeaseDraft) => void
  onGuided?: () => void
}
interface Output { url: string; digest: string; ids: string[]; noCandidatesAcknowledged: boolean }

export function PdfRedactionWorkspace({ onBack, status = null, onExtracted, onGuided }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [inspection, setInspection] = useState<RedactionInspection | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [output, setOutput] = useState<Output | null>(null)
  const [noCandidatesReviewed, setNoCandidatesReviewed] = useState(false)
  const [consent, setConsent] = useState(false)
  const [working, setWorking] = useState<'inspect' | 'export' | 'analyze' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const operationToken = useRef(0)
  const analysisController = useRef<AbortController | null>(null)
  const busy = working !== null

  useEffect(() => () => { if (output) URL.revokeObjectURL(output.url) }, [output])
  useEffect(() => () => { operationToken.current += 1; analysisController.current?.abort() }, [])

  const invalidateApproval = () => {
    operationToken.current += 1
    analysisController.current?.abort()
    setWorking(null); setOutput(null); setConsent(false); setError(null)
  }
  const resetForFile = (next: File | null) => {
    invalidateApproval()
    setInspection(null); setSelected(new Set()); setNoCandidatesReviewed(false); setFile(next)
  }
  const inspect = async () => {
    if (!file || busy) return
    if (!file.name.toLowerCase().endsWith('.pdf') || file.type !== 'application/pdf' || file.size === 0 || file.size > 10 * 1024 * 1024) {
      setError('Choose a nonempty PDF no larger than 10 MB.'); return
    }
    const token = ++operationToken.current
    setWorking('inspect'); setError(null)
    try {
      const result = await inspectPdfForRedaction(file)
      if (token === operationToken.current) setInspection(result)
    } catch (cause) {
      if (token === operationToken.current) setError(cause instanceof Error ? cause.message : 'This PDF could not be inspected safely.')
    } finally { if (token === operationToken.current) setWorking(null) }
  }
  const canExport = inspection && (inspection.candidates.length ? selected.size > 0 : noCandidatesReviewed)
  const exportPdf = async () => {
    if (!file || !inspection || !canExport || busy) return
    const token = ++operationToken.current
    const ids = [...selected]
    setWorking('export'); setError(null); setConsent(false)
    try {
      const result = await exportRedactedPdf(file, inspection, ids, noCandidatesReviewed)
      if (token === operationToken.current) setOutput({ url: URL.createObjectURL(result.blob), digest: result.digest, ids, noCandidatesAcknowledged: noCandidatesReviewed })
    } catch (cause) {
      if (token === operationToken.current) setError(cause instanceof Error ? cause.message : 'The PDF could not be verified after redaction.')
    } finally { if (token === operationToken.current) setWorking(null) }
  }
  const analyze = async () => {
    if (!file || !inspection || !output || !consent || !status?.service_ready || !onExtracted || busy) return
    const token = ++operationToken.current
    analysisController.current = new AbortController()
    setWorking('analyze'); setError(null)
    try {
      const draft = await extractApprovedPdf(file, {
        document_digest: inspection.document_digest, approved_pdf_digest: output.digest,
        candidate_ids: output.ids, consent_to_gemini: true, acknowledge_no_candidates: output.noCandidatesAcknowledged,
      }, analysisController.current.signal)
      if (token === operationToken.current) onExtracted(draft)
    } catch (cause) {
      if (token === operationToken.current) setError(cause instanceof Error ? cause.message : 'AI analysis failed. Your PDF download remains available.')
    } finally { if (token === operationToken.current) setWorking(null) }
  }
  const toggle = (id: string) => {
    invalidateApproval()
    setSelected(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  return <section className="surface mx-auto max-w-5xl p-5 md:p-7" aria-labelledby="redaction-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="kicker">Privacy-first PDF tool</div><h2 id="redaction-title" className="mt-2 font-display text-3xl">Redact personal information from a lease PDF</h2></div>
      <button type="button" onClick={onBack} className="min-h-10 rounded-lg border border-line px-3 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest">Back to Analyze</button>
    </div>
    <ol className="mt-5 flex flex-wrap gap-2 text-sm" aria-label="Redaction steps">
      <li className={`rounded-full px-3 py-1 ${!inspection ? 'bg-forest text-white' : 'bg-canvas text-muted'}`}>1. Upload</li>
      <li className={`rounded-full px-3 py-1 ${inspection && !output ? 'bg-forest text-white' : 'bg-canvas text-muted'}`}>2. Review regions</li>
      <li className={`rounded-full px-3 py-1 ${output ? 'bg-forest text-white' : 'bg-canvas text-muted'}`}>3. Review PDF and choose analysis</li>
    </ol>
    {!inspection && <div className="mt-6 space-y-4">
      <p className="max-w-3xl text-sm leading-relaxed text-muted">NestWise receives the original PDF to inspect and redact it. Inspection and export do not send it to Gemini. Only the verified document you later approve is sent to Google Gemini, after separate consent. Automatic detection can miss private information.</p>
      <label htmlFor="redaction-pdf" className="label">Choose a text-based PDF (up to 10 MB and 80 pages)</label>
      <input id="redaction-pdf" type="file" accept="application/pdf,.pdf" className="field" onChange={event => resetForFile(event.target.files?.[0] ?? null)} />
      {file && <p className="text-sm text-muted">PDF selected ({(file.size / 1024 / 1024).toFixed(2)} MB)</p>}
      <button type="button" disabled={!file || busy} onClick={() => void inspect()} className="min-h-11 rounded-xl bg-forest px-5 font-bold text-white disabled:opacity-50">{working === 'inspect' ? 'Inspecting PDF...' : 'Inspect PDF'}</button>
    </div>}
    {inspection && !output && <div className="mt-6 space-y-6">
      <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">Proposed regions require your review. Select only the regions you approve for permanent removal. Automatic detection can miss personal information.</p>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)]">
        <div className="space-y-5" aria-label="PDF page previews">{inspection.pages.map(page => <figure key={page.page_number} className="rounded-xl border border-line bg-canvas p-3">
          <figcaption className="mb-2 text-sm font-bold">Page {page.page_number} preview</figcaption>
          <div className="relative mx-auto w-fit max-w-full">
            <img src={page.image_data_url} alt={`PDF page ${page.page_number} preview with proposed redaction locations`} className="block max-h-[70vh] max-w-full" />
            {inspection.candidates.filter(item => item.page_number === page.page_number).map(candidate => {
              const [x0, y0, x1, y1] = candidate.bbox
              return <div key={candidate.id} aria-hidden="true" className={`pointer-events-none absolute border-2 ${selected.has(candidate.id) ? 'border-coral bg-coral/50' : 'border-amber-500 bg-amber-300/20'}`} style={{ left: `${x0 / page.width * 100}%`, top: `${y0 / page.height * 100}%`, width: `${(x1 - x0) / page.width * 100}%`, height: `${(y1 - y0) / page.height * 100}%` }} />
            })}
          </div>
        </figure>)}</div>
        <div><h3 className="font-display text-xl">Proposed redactions</h3><p className="mt-1 text-xs text-muted">Use these checkboxes to approve each region. Private values are visible only in the document preview.</p>
          <ul className="mt-3 space-y-3">{inspection.candidates.map(candidate => <li key={candidate.id} className="rounded-xl border border-line p-3">
            <label className="flex cursor-pointer items-start gap-3"><input type="checkbox" disabled={busy} checked={selected.has(candidate.id)} onChange={() => toggle(candidate.id)} className="mt-1 h-5 w-5 accent-forest focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest" />
              <span><span className="block font-bold">{candidate.label}</span><span className="mt-1 block text-xs text-muted">Page {candidate.page_number}: {selected.has(candidate.id) ? 'approved for removal' : 'proposed, review required'}</span></span>
            </label>
          </li>)}</ul>
        </div>
      </div>
      {inspection.candidates.length === 0 && <div className="space-y-3">
        <p role="status" className="text-sm text-muted">No supported identifier candidates were detected. This does not mean the PDF contains no private information. Custom redaction regions are not available.</p>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={noCandidatesReviewed} disabled={busy} onChange={event => { invalidateApproval(); setNoCandidatesReviewed(event.target.checked) }} className="mt-1 h-5 w-5 accent-forest" /><span>I have independently reviewed this PDF even though automatic detection found no candidates.</span></label>
      </div>}
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={!canExport || busy} onClick={() => void exportPdf()} className="min-h-11 rounded-xl bg-forest px-5 font-bold text-white disabled:opacity-50">{working === 'export' ? 'Preparing and verifying...' : inspection.candidates.length ? `Create redacted PDF (${selected.size} approved)` : 'Prepare reviewed PDF'}</button>
        <button type="button" onClick={() => resetForFile(null)} className="min-h-11 rounded-xl border border-line px-4 font-bold">Choose a different PDF</button>
      </div>
    </div>}
    {output && <div className="mt-6 space-y-4">
      <h3 className="font-display text-2xl">Review your redacted PDF</h3>
      <p role="status" className="rounded-xl border border-mint bg-mint/30 p-3 text-sm text-ink">{output.ids.length ? `${output.ids.length} approved regions were applied and the PDF passed backend verification.` : 'No regions were detected or removed. The PDF was rewritten and verified after your independent-review acknowledgment.'} Review the exported document before sharing it. Automatic detection may miss personal information.</p>
      <iframe title="Preview of verified redacted PDF" src={output.url} className="h-[70vh] w-full rounded-xl border border-line" />
      <div className="flex flex-wrap gap-3">
        <a href={output.url} download="nestwise-redacted.pdf" className="inline-flex min-h-11 items-center rounded-xl bg-forest px-5 font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest">Download redacted PDF</a>
        <button type="button" onClick={invalidateApproval} className="min-h-11 rounded-xl border border-line px-4 font-bold">Change approved redactions</button>
        <button type="button" onClick={() => resetForFile(null)} className="min-h-11 rounded-xl border border-line px-4 font-bold">Choose a different PDF</button>
      </div>
      <div className="space-y-4 rounded-xl border border-line bg-canvas p-4">
        <p className="text-sm text-muted">Downloading does not contact Gemini. AI analysis is optional. The backend will recreate and verify this exact approved version before submitting it to Google Gemini.</p>
        {status?.service_ready && onExtracted ? <>
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} className="mt-1 h-5 w-5 accent-forest focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest" /><span>I have reviewed the redacted document and understand that automatic detection may miss personal information. I agree to send the approved redacted PDF to Google Gemini for lease analysis.</span></label>
          <button type="button" disabled={!consent || busy} onClick={() => void analyze()} className="min-h-11 rounded-xl bg-forest px-5 font-bold text-white disabled:opacity-50">{working === 'analyze' ? 'Analyzing approved PDF...' : 'Analyze approved PDF with AI'}</button>
        </> : <p className="text-sm text-muted">AI analysis is unavailable on this service. Your PDF preview, download, and guided rental analysis remain available.</p>}
        <button type="button" onClick={onGuided || onBack} className="block min-h-10 text-sm font-bold text-forest underline underline-offset-4">Continue with guided rental analysis</button>
      </div>
    </div>}
    {working === 'analyze' && <p role="status" className="mt-4 text-sm text-forest">Rechecking the approved document and requesting candidate terms. No retries are sent automatically.</p>}
    {error && <p role="alert" className="mt-4 rounded-xl border border-coral/40 bg-coral/10 p-3 text-sm text-ink">{error}</p>}
  </section>
}
