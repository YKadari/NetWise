import { guidedQuestions, type GuidedDraft } from '../lib/guidedAdvisor'

export function GuidedQuestions({ answers }: { answers: GuidedDraft }) {
  const questions = guidedQuestions(answers)
  return <section className="surface p-5" aria-label="Questions to ask before signing"><div className="kicker">Before you sign</div><h2 className="mt-1 font-display text-2xl">Questions to ask before signing</h2><p className="mt-2 text-sm text-muted">These questions come from what is still unclear in your answers. They are prompts to verify, not claims about this rental.</p><ol className="mt-4 list-decimal space-y-2 pl-6 text-sm text-ink">{questions.map(question => <li key={question}>{question}</li>)}</ol></section>
}
