import { useEffect, useRef, useState } from 'react'
import { generateRentalDecisionBrief, getRentalFollowUps } from '../lib/rentalApi'
import { money } from '../lib/rentalForms'
import type { FinancialProfile, LeaseServiceStatus, RentalDecisionBrief, RentalEvaluation, RentalFollowUpResponse, RentalOffer } from '../types/rental'

interface Props { offer: RentalOffer; result: RentalEvaluation; profile?: FinancialProfile; status: LeaseServiceStatus | null; profileStale: boolean }
const unknownLabels: Record<string, string> = {
  recurring_charges: 'required monthly fees', utilities: 'utility costs', security_deposit: 'security deposit',
  first_month_rent_due_upfront: 'first-month rent timing', last_month_rent_due_upfront: 'last-month prepayment',
  nonrefundable_fees: 'one-time fees', other_upfront_charges: 'other move-in charges', holding_deposit: 'holding deposit',
  security_deposit_credit_target: 'deposit credit', nonrefundable_fee_credit_target: 'fee credit',
  unreviewed_extracted_terms: 'unreviewed lease terms',
}

export function RentalOverview({ offer, result, profile, status, profileStale }: Props) {
  const [generated, setGenerated] = useState<{ key: string; brief: RentalDecisionBrief } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [suggested, setSuggested] = useState<{ key: string; data: RentalFollowUpResponse } | null>(null)
  const [suggestionError, setSuggestionError] = useState(false)
  const [copyStatus, setCopyStatus] = useState('')
  const request = useRef<AbortController | null>(null)
  const fallbackRequest = useRef<AbortController | null>(null)
  const key = JSON.stringify([offer, result])
  const brief = status?.service_ready && !profileStale && generated?.key === key ? generated.brief : null
  const currentSuggested = !profileStale && suggested?.key === key ? suggested.data : null
  useEffect(() => {
    request.current?.abort()
    fallbackRequest.current?.abort()
    setBusy(false)
    setError(null)
    setSuggested(null)
    setSuggestionError(false)
    if (!profileStale) {
      const controller = new AbortController()
      fallbackRequest.current = controller
      void getRentalFollowUps(offer, profile, controller.signal).then(data => {
        if (!controller.signal.aborted) setSuggested({ key, data })
      }).catch(() => {
        if (!controller.signal.aborted) { setSuggested(null); setSuggestionError(true) }
      })
    }
    return () => fallbackRequest.current?.abort()
  }, [key, profileStale, status?.service_ready])
  const generate = async () => {
    if (busy || profileStale) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true); setError(null); setGenerated(null)
    try {
      const result = await generateRentalDecisionBrief(offer, profile, controller.signal)
      if (!controller.signal.aborted) { setGenerated({ key, brief: result }); setError(null) }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'AI insights are unavailable. Your rental overview remains available.')
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  const unknowns = [...new Set(result.unknown_cost_categories)].map(id => unknownLabels[id] || 'another rental term')
  const nextAction = unknowns.length
    ? 'Ask for an itemized list of required charges and move-in payments before signing.'
    : 'Confirm the stated charges and ask what you would owe if you left before the lease ends.'
  const questions = brief?.follow_ups ?? currentSuggested?.follow_ups ?? []
  const additional = brief?.additional_follow_ups ?? currentSuggested?.additional_follow_ups ?? []
  const questionSource = brief ? 'AI-prioritized questions' : 'Suggested questions'
  const copyQuestion = async (question: string) => {
    try { await navigator.clipboard.writeText(question); setCopyStatus('Question copied.') }
    catch { setCopyStatus('Could not copy automatically. Select and copy the question text.') }
  }
  const copyAll = async () => {
    const all = [...questions, ...additional]
    try { await navigator.clipboard.writeText(`Questions about this rental:\n\n${all.map(item => `- ${item.question}`).join('\n\n')}`); setCopyStatus('All questions copied.') }
    catch { setCopyStatus('Could not copy automatically. Select and copy the questions.') }
  }
  return <section className="surface overflow-hidden" aria-label="Your rental overview">
    <div className="bg-ink px-5 py-6 text-white md:px-7"><div className="text-xs font-bold uppercase tracking-widest text-[#a5d3bf]">Your rental overview</div><h2 className="mt-2 font-display text-3xl">See the commitment beyond rent.</h2><p className="mt-3 max-w-3xl text-sm leading-relaxed text-white/85">{result.monthly_costs.monthly_costs_complete ? 'Identified monthly housing costs' : 'Known monthly housing subtotal'}{offer.utilities?.status === 'estimated' ? ' (including estimated utilities)' : ''}: {money(result.monthly_costs.gross_known_monthly_housing_obligation)} against {money(result.monthly_costs.base_rent_before_concessions)} advertised rent. {result.upfront.upfront_cash_complete ? 'Move-in cash' : 'Known move-in cash subtotal'}: {money(result.upfront.upfront_cash_required)}. {result.lease_totals.nonrefundable_cost_complete ? 'Modeled lease expense' : 'Known lease expense subtotal'}: {money(result.lease_totals.known_modeled_nonrefundable_lease_cost)} over {result.lease.term_months} months.</p></div>
    <div className="grid gap-4 p-5 md:grid-cols-2 md:p-7"><div><h3 className="font-bold text-ink">What remains uncertain?</h3><p className="mt-2 text-sm text-muted">{unknowns.length ? `${unknowns.join(', ')}. Unknown costs are excluded from known subtotals.` : 'No cost category was marked unknown in the supplied terms. Check the agreement for anything omitted.'}</p>{result.upfront.refundable_cash_held > 0 && <p className="mt-2 text-sm text-muted">{money(result.upfront.refundable_cash_held)} is potentially refundable cash held, separate from lease expense. Its return is not guaranteed.</p>}</div><div><h3 className="font-bold text-ink">A useful next step</h3><p className="mt-2 text-sm text-muted">{nextAction}</p>{status?.service_ready && !profileStale && <button type="button" disabled={busy} className="mt-4 min-h-11 rounded-xl border border-forest px-4 text-sm font-bold text-forest focus-visible:outline focus-visible:outline-4 focus-visible:outline-mint disabled:opacity-50" onClick={() => void generate()}>{busy ? 'Generating AI insights…' : brief ? 'Regenerate AI insights' : 'Generate AI insights'}</button>}{busy && <p role="status" className="mt-2 text-sm text-muted">Checking this evaluation with Gemini. Your financial totals will not change.</p>}{error && <p role="alert" className="mt-2 text-sm text-coral">{error}</p>}{profileStale && <p className="mt-2 text-sm text-muted">Refresh the financial results before requesting new AI insights.</p>}</div></div>
    {brief && <div className="border-t border-line bg-mint/40 p-5 md:p-7" aria-label="AI rental insights"><div className="kicker">AI rental insights</div><h3 className="mt-1 font-display text-2xl">{brief.headline}</h3><p className="mt-2 text-sm">{brief.overall_summary}</p><ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{brief.important_findings.map(item => <li key={item}>{item}</li>)}</ul>{brief.key_uncertainties.length > 0 && <p className="mt-3 text-sm"><strong>Unconfirmed:</strong> {brief.key_uncertainties.join(' ')}</p>}<p className="mt-3 text-sm"><strong>Next:</strong> {brief.suggested_next_step}</p><p className="mt-3 text-xs text-muted">Selected from statements grounded in the recalculated rental facts. Review the agreement and the figures above before deciding.</p></div>}
    <div className="border-t border-line p-5 md:p-7" aria-label="Before you sign"><div className="flex flex-wrap items-end justify-between gap-3"><div><div className="kicker">{questionSource}</div><h3 className="mt-1 font-display text-2xl">Before you sign</h3><p className="mt-1 text-sm text-muted">A short list based on the confirmed rental terms and evaluator results.</p></div>{questions.length + additional.length > 0 && <button type="button" onClick={() => void copyAll()} className="min-h-10 rounded-xl border border-forest px-3 text-sm font-bold text-forest focus-visible:outline focus-visible:outline-4 focus-visible:outline-mint">Copy all questions</button>}</div>
      {profileStale ? <p className="mt-4 text-sm text-muted">Refresh the financial results to update these questions.</p> : !currentSuggested && !brief && !suggestionError ? <p role="status" className="mt-4 text-sm text-muted">Updating suggested questions…</p> : suggestionError && !brief ? <p role="alert" className="mt-4 text-sm text-coral">Suggested questions are temporarily unavailable. Review the unknown cost items above before signing.</p> : questions.length === 0 ? <p className="mt-4 rounded-xl bg-mint/40 p-4 text-sm text-forest">No significant unanswered cost items were identified from the supplied terms. Confirm the written agreement before signing.</p> : <ol className="mt-4 grid gap-3 md:grid-cols-2">{questions.map((item, index) => <li key={`${index}-${item.title}`} className="rounded-xl border border-line bg-white p-4"><div className="flex items-start justify-between gap-2"><h4 className="font-bold text-ink">{item.title}</h4><span className="shrink-0 rounded-full bg-mint px-2 py-1 text-xs font-bold text-forest">{item.priority}</span></div><p className="mt-2 text-sm text-muted"><strong>Why it matters:</strong> {item.why_it_matters}</p><p className="mt-3 text-sm text-ink"><strong>Ask:</strong> “{item.question}”</p><details className="mt-2 text-xs text-muted"><summary className="cursor-pointer font-semibold text-forest">Underlying facts</summary><p className="mt-1">{item.facts}</p></details><button type="button" onClick={() => void copyQuestion(item.question)} className="mt-3 min-h-9 rounded-lg border border-forest px-3 text-sm font-bold text-forest focus-visible:outline focus-visible:outline-4 focus-visible:outline-mint">Copy question</button></li>)}</ol>}
      {additional.length > 0 && <details className="mt-4"><summary className="cursor-pointer text-sm font-bold text-forest">See all questions ({questions.length + additional.length})</summary><ul className="mt-3 space-y-3">{additional.map((item, index) => <li key={`${index}-${item.title}`} className="rounded-xl border border-line bg-white p-4"><h4 className="font-bold">{item.title}</h4><p className="mt-1 text-sm text-muted">{item.why_it_matters}</p><p className="mt-2 text-sm">Ask: “{item.question}”</p><button type="button" onClick={() => void copyQuestion(item.question)} className="mt-2 min-h-9 rounded-lg border border-forest px-3 text-sm font-bold text-forest">Copy question</button></li>)}</ul></details>}
      <p className="sr-only" role="status" aria-live="polite">{copyStatus}</p>{error && <p className="mt-3 text-sm text-coral">AI prioritization did not load. Deterministic suggested questions remain available.</p>}
    </div>
  </section>
}
