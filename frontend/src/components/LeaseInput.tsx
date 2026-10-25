import { useEffect, useState, type FormEvent } from 'react'
import { syntheticLeaseText } from '../lib/rentalForms'
import type { LeaseServiceStatus } from '../types/rental'

interface Props {
  initialMethod?: 'text' | 'pdf'
  status: LeaseServiceStatus | null
  busy: boolean
  error: string | null
  authConfigured?: boolean
  authLoading?: boolean
  authBusy?: boolean
  authUser?: boolean
  authError?: string | null
  onSignIn?: () => void
  onSignOut?: () => void
  onText: (text: string) => void
  onPdf: (file: File) => void
}

export function LeaseInput({ initialMethod = 'text', status, busy, error, authConfigured, authLoading, authBusy, authUser, authError, onSignIn, onSignOut, onText, onPdf }: Props) {
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [method, setMethod] = useState<'text' | 'pdf'>(initialMethod)
  const [localError, setLocalError] = useState<string | null>(null)
  useEffect(() => { setMethod(initialMethod) }, [initialMethod])

  const authRequired = status?.authentication_required === true
  const serviceUnavailable = status?.service_ready === false
  const authNotConfigured = authRequired && authConfigured === false
  const signInRequired = authRequired && !serviceUnavailable && !authNotConfigured && !authUser
  const extractionHidden = serviceUnavailable || authNotConfigured || signInRequired || Boolean(authLoading)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (busy || extractionHidden) return
    if (method === 'text') {
      if (!text.trim() || text.length > 120_000) { setLocalError('Paste between 1 and 120,000 characters of lease text.'); return }
      setLocalError(null); onText(text)
    } else {
      if (!file || !file.name.toLowerCase().endsWith('.pdf') || file.type !== 'application/pdf') { setLocalError('Choose a PDF file.'); return }
      if (file.size === 0 || file.size > 10 * 1024 * 1024) { setLocalError('PDF must be nonempty and no larger than 10 MB.'); return }
      setLocalError(null); onPdf(file)
    }
  }

  return <section className="space-y-4" aria-label="Lease document input">
    {serviceUnavailable && <div className="max-w-xl rounded-2xl border border-line bg-canvas p-5"><h3 className="font-display text-xl">AI lease review is temporarily unavailable</h3><p className="mt-2 text-sm text-muted">You can still enter rental terms manually or try the synthetic sample.</p></div>}
    {authNotConfigured && <div className="max-w-xl rounded-2xl border border-line bg-canvas p-5"><h3 className="font-display text-xl">Google sign-in is not available</h3><p className="mt-2 text-sm text-muted">The demo host has not finished configuring sign-in. Manual rental analysis and the synthetic sample remain available.</p></div>}
    {authLoading && <p role="status" className="text-sm text-muted">Checking Google sign-in…</p>}
    {signInRequired && <div className="max-w-xl space-y-4 rounded-2xl border border-line bg-canvas p-5"><div className="kicker">AI lease review</div><h3 className="font-display text-2xl">Continue with Google</h3><p className="text-sm leading-relaxed text-muted">Sign in to use limited AI lease extraction during the hackathon demo. You can browse housing, enter rental terms manually, and use the sample without signing in.</p>{authError && <p role="alert" className="text-sm text-red-800">{authError}</p>}<button type="button" disabled={authBusy} onClick={onSignIn} className="min-h-11 rounded-xl bg-forest px-5 text-sm font-bold text-white disabled:opacity-50">{authBusy ? 'Connecting to Google…' : 'Continue with Google'}</button></div>}
    <div hidden={extractionHidden}>
      {authRequired && authUser && <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-canvas p-3 text-sm"><span>Signed in. Your Google sign-in is used only to authorize extraction.</span><button type="button" disabled={authBusy} className="font-bold text-forest underline" onClick={onSignOut}>Sign out</button></div>}
      <div className="flex flex-wrap gap-2"><button type="button" aria-pressed={method === 'text'} onClick={() => { setMethod('text'); setLocalError(null) }} className={`min-h-11 rounded-xl border px-4 text-sm font-bold ${method === 'text' ? 'border-forest bg-mint text-forest' : 'border-line bg-white'}`}>Paste lease text</button><button type="button" aria-pressed={method === 'pdf'} onClick={() => { setMethod('pdf'); setLocalError(null) }} className={`min-h-11 rounded-xl border px-4 text-sm font-bold ${method === 'pdf' ? 'border-forest bg-mint text-forest' : 'border-line bg-white'}`}>Upload PDF</button></div>
      <form onSubmit={submit} className="mt-4 space-y-4">
        {method === 'text' ? <><label className="label" htmlFor="lease-text">Lease provisions</label><textarea id="lease-text" className="field min-h-48" maxLength={120000} value={text} onChange={event => setText(event.target.value)} placeholder="Paste a sample lease or the relevant provisions…"/><div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted"><span>{text.length.toLocaleString()} / 120,000 characters</span><button type="button" className="font-bold text-forest underline" onClick={() => { setText(syntheticLeaseText); setLocalError(null) }}>Use synthetic AI demo text</button></div></> : <><label className="label" htmlFor="lease-pdf">PDF lease file</label><input id="lease-pdf" className="field" type="file" accept=".pdf,application/pdf" onChange={event => { setFile(event.target.files?.[0] ?? null); setLocalError(null) }}/><p className="text-sm text-muted">{file ? `Selected: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)` : 'Choose a PDF up to 10 MB and 80 pages.'}</p></>}
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">Documents you submit are sent to Google Gemini for extraction. This demo uses Gemini Free Tier: do not upload leases containing names, signatures, account numbers, or other private information. Use a redacted or synthetic document. Review every finding; the AI may be wrong. Documents are not saved by NestWise.</p>
        {(localError || error || authError) && <p role="alert" className="text-sm text-red-800">{localError || error || authError}</p>}
        {busy && <p role="status" className="text-sm text-forest">{method === 'pdf' ? 'Uploading and processing the PDF…' : 'Extracting candidate terms…'} This can take a moment.</p>}
        <button type="submit" disabled={busy || status?.service_ready === false} className="min-h-11 rounded-xl bg-forest px-5 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Processing…' : method === 'pdf' ? 'Extract PDF terms' : 'Extract lease terms'}</button>
      </form>
    </div>
  </section>
}
