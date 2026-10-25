import type { CandidateTerm } from '../types/rental'

export function LeaseEvidenceDisclosure({ term }: { term: CandidateTerm }) {
  const evidence = term.evidence_verification === 'verified_text'
    ? 'Matched to your lease text.'
    : term.evidence_verification === 'verified_page'
      ? 'Matched to text on this PDF page.'
      : term.evidence_verification === 'unverified'
        ? 'AI suggested this excerpt. Please verify it against your lease.'
        : 'No supporting excerpt was provided.'
  return <details className="mt-2 rounded-lg bg-canvas px-3 py-2 text-sm">
    <summary className="cursor-pointer font-semibold text-forest">Where did this come from?</summary>
    <div className="mt-2 space-y-2 text-muted">
      {term.source_excerpt ? <blockquote className="border-l-2 border-forest/40 pl-3 text-ink">“{term.source_excerpt}”</blockquote> : <p>No excerpt was returned for this term.</p>}
      <p>{evidence}{term.page_reference ? ` Page ${term.page_reference}.` : ''}</p>
    </div>
  </details>
}
