import type { CandidateTerm } from '../types/rental'

export function LeaseEvidenceDisclosure({ term }: { term: CandidateTerm }) {
  const evidence = term.evidence_verification === 'verified_text'
    ? 'Matched to your lease text.'
    : term.evidence_verification === 'verified_page'
      ? 'Matched to text on this PDF page.'
      : term.evidence_verification === 'unverified'
        ? 'AI suggested this excerpt. Please verify it against your lease.'
        : 'No supporting excerpt was provided.'
  return <details className="mt-1 text-xs">
    <summary className="w-fit cursor-pointer rounded py-2 font-semibold text-forest focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest">View source<span className="sr-only"> — where did this come from?</span></summary>
    <div className="mt-2 space-y-2 text-muted">
      {term.source_excerpt ? <blockquote className="border-l-2 border-forest/40 pl-3 text-ink">“{term.source_excerpt}”</blockquote> : <p>No excerpt was returned for this term.</p>}
      <p>{evidence}{term.page_reference ? ` Page ${term.page_reference}.` : ''}</p>
    </div>
  </details>
}
