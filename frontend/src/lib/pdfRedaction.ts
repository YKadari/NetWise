export interface RedactionCandidate {
  id: string
  page_number: number
  bbox: [number, number, number, number]
  category: string
  label: string
  review_required: true
}

export interface RedactionPagePreview {
  page_number: number
  width: number
  height: number
  image_data_url: string
}

export interface RedactionInspection {
  document_digest: string
  candidates: RedactionCandidate[]
  pages: RedactionPagePreview[]
  page_count: number
  warning: string
}

export interface VerifiedPdfExport { blob: Blob; digest: string }
export interface RedactedPdfApproval {
  document_digest: string
  approved_pdf_digest: string
  candidate_ids: string[]
  consent_to_gemini: true
  acknowledge_no_candidates: boolean
}

async function checkedJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = ''
    try {
      const body = await response.json() as { detail?: string }
      if (typeof body.detail === 'string') detail = body.detail
    } catch { /* keep fixed fallback */ }
    throw new Error(detail || `PDF request failed (${response.status}).`)
  }
  try { return await response.json() as T }
  catch { throw new Error('The PDF service returned an unreadable response.') }
}

export async function inspectPdfForRedaction(file: File): Promise<RedactionInspection> {
  const body = new FormData()
  body.append('file', file)
  const response = await fetch('/api/pdf-redaction/inspect', { method: 'POST', body, cache: 'no-store' })
  const result = await checkedJson<RedactionInspection>(response)
  if (!/^[0-9a-f]{64}$/.test(result.document_digest) || !Array.isArray(result.candidates) || !Array.isArray(result.pages)) {
    throw new Error('The PDF inspection response was incomplete.')
  }
  return result
}

export async function exportRedactedPdf(file: File, inspection: RedactionInspection, candidateIds: string[], acknowledgeNoCandidates = false): Promise<VerifiedPdfExport> {
  const body = new FormData()
  body.append('file', file)
  body.append('document_digest', inspection.document_digest)
  candidateIds.forEach(id => body.append('candidate_ids', id))
  body.append('acknowledge_no_candidates', String(acknowledgeNoCandidates))
  const response = await fetch('/api/pdf-redaction/export', { method: 'POST', body, cache: 'no-store' })
  if (!response.ok) {
    let detail = ''
    try { const bodyJson = await response.json() as { detail?: string }; if (typeof bodyJson.detail === 'string') detail = bodyJson.detail } catch { /* fixed fallback */ }
    throw new Error(detail || `PDF export failed (${response.status}).`)
  }
  if (!(response.headers.get('content-type') || '').toLowerCase().includes('application/pdf')) {
    throw new Error('The PDF service did not return a verified PDF.')
  }
  const digest = response.headers.get('x-redacted-pdf-sha256') || ''
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error('The verified PDF identifier is missing. Generate the PDF again before analysis.')
  return { blob: await response.blob(), digest }
}
