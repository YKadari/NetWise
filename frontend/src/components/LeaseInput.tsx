import { useEffect, useState, type FormEvent } from 'react'
import { syntheticLeaseText } from '../lib/rentalForms'
import type { LeaseServiceStatus } from '../types/rental'

interface Props { initialMethod?: 'text' | 'pdf'; textOnly?: boolean; status: LeaseServiceStatus | null; busy: boolean; error: string | null; onText: (text: string) => void; onPdf: (file: File) => void; onManual?: () => void }

export function LeaseInput({ initialMethod = 'text', textOnly = false, status, busy, error, onText, onPdf, onManual }: Props) {
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [method, setMethod] = useState<'text' | 'pdf'>(initialMethod)
  const [localError, setLocalError] = useState<string | null>(null)
  useEffect(() => { setMethod(textOnly ? 'text' : initialMethod) }, [initialMethod, textOnly])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (method === 'text') {
      if (!text.trim() || text.length > 120_000) { setLocalError('Paste between 1 and 120,000 characters of lease text.'); return }
      setLocalError(null); onText(text)
    } else {
      if (!file || !file.name.toLowerCase().endsWith('.pdf') || file.type !== 'application/pdf') { setLocalError('Choose a PDF file.'); return }
      if (file.size === 0 || file.size > 10 * 1024 * 1024) { setLocalError('PDF must be nonempty and no larger than 10 MB.'); return }
      setLocalError(null); onPdf(file)
    }
  }
  return <section className="space-y-4" aria-label="Lease document input">{!textOnly && <div className="flex flex-wrap gap-2"><button type="button" aria-pressed={method === 'text'} onClick={() => { setMethod('text'); setLocalError(null) }} className={`min-h-11 rounded-xl border px-4 text-sm font-bold ${method === 'text' ? 'border-forest bg-mint text-forest' : 'border-line bg-white'}`}>Paste lease text</button><button type="button" aria-pressed={method === 'pdf'} onClick={() => { setMethod('pdf'); setLocalError(null) }} className={`min-h-11 rounded-xl border px-4 text-sm font-bold ${method === 'pdf' ? 'border-forest bg-mint text-forest' : 'border-line bg-white'}`}>Upload PDF</button></div>}
    <form onSubmit={submit} className="space-y-4">
      {method === 'text' ? <><label className="label" htmlFor="lease-text">Lease provisions</label><textarea id="lease-text" className="field min-h-48" maxLength={120000} value={text} onChange={event => setText(event.target.value)} placeholder="Paste a sample lease or the relevant provisions…"/><div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted"><span>{text.length.toLocaleString()} / 120,000 characters</span><button type="button" className="font-bold text-forest underline" onClick={() => { setText(syntheticLeaseText); setLocalError(null) }}>Use synthetic AI demo text</button></div></> : <><label className="label" htmlFor="lease-pdf">PDF lease file</label><input id="lease-pdf" className="field" type="file" accept=".pdf,application/pdf" onChange={event => { setFile(event.target.files?.[0] ?? null); setLocalError(null) }}/><p className="text-sm text-muted">{file ? `Selected: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)` : 'Choose a PDF up to 10 MB and 80 pages.'}</p></>}
      <p className="rounded-xl border border-line bg-canvas p-3 text-sm text-muted">{textOnly ? 'Your pasted text' : 'Your text or PDF'} is sent to Google Gemini through the NestWise backend for extraction. Review every returned term before evaluating it. Nothing is saved in browser storage.</p>
      {status && !status.service_ready && <p className="text-sm text-coral">Live AI lease extraction is temporarily unavailable on this deployment. You can still use guided rental analysis.</p>}
      {(localError || error) && <p role="alert" className="text-sm text-red-800">{localError || error}</p>}
      {error && !busy && <div className="flex flex-wrap gap-3">{!textOnly && <button type="button" className="min-h-11 rounded-lg border border-line px-3 text-sm font-bold text-forest" onClick={() => { setMethod('text'); setLocalError(null) }}>Paste text instead</button>}{onManual && <button type="button" className="min-h-11 rounded-lg border border-line px-3 text-sm font-bold text-forest" onClick={onManual}>{textOnly ? 'Start guided analysis' : 'Enter terms manually'}</button>}</div>}
      {busy && <p role="status" className="text-sm text-forest">{method === 'pdf' ? 'Uploading and processing the PDF…' : 'Extracting candidate terms…'} This can take a moment.</p>}
      <button type="submit" disabled={busy || status?.service_ready === false} className="min-h-11 rounded-xl bg-forest px-5 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Processing…' : method === 'pdf' ? 'Extract PDF terms' : 'Extract lease terms'}</button>
    </form>
  </section>
}
