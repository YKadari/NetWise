import { useEffect, useState } from 'react'
import { confirmLease, evaluateRental, extractLeaseText, leaseServiceStatus, stressRental } from '../lib/rentalApi'
import { blankProfile, demoOffers, money, profileToRequest, type ProfileDraft } from '../lib/rentalForms'
import type { FinancialProfile, LeaseDraft, LeaseServiceStatus, RentalEvaluation, RentalOffer, ReviewDecision, StressResult, StressScenario } from '../types/rental'
import type { ProductView } from './ProductNavigation'
import { RentalInput } from './RentalInput'
import { LeaseInput } from './LeaseInput'
import { LeaseReview } from './LeaseReview'
import { FinancialProfileForm } from './FinancialProfileForm'
import { RentalResults } from './RentalResults'
import { RentalStressPanel } from './RentalStressPanel'
import { RentalComparison } from './RentalComparison'
import { GuidedAdvisor } from './GuidedAdvisor'
import { RentalOverview } from './RentalOverview'
import { PdfRedactionWorkspace } from './PdfRedactionWorkspace'
import { blankGuided, sampleGuided, type GuidedDraft } from '../lib/guidedAdvisor'

interface Props { view: ProductView; onNavigate: (view: ProductView) => void }
type Entry = 'manual' | 'lease' | 'guided' | null
type Step = 'start' | 'entry' | 'review' | 'results'
type Operation = 'extract' | 'confirm' | 'evaluate' | 'stress' | 'demo' | null
const cameFromDocument = (candidate: RentalOffer | null) => Boolean(candidate && 'base_rent_provenance' in candidate)

export function RentalWorkspace({ view, onNavigate }: Props) {
  const [entry, setEntry] = useState<Entry>(null)
  const [leaseMethod, setLeaseMethod] = useState<'text' | 'pdf'>('text')
  const [step, setStep] = useState<Step>('start')
  const [status, setStatus] = useState<LeaseServiceStatus | null>(null)
  const [draft, setDraft] = useState<LeaseDraft | null>(null)
  const [seed, setSeed] = useState<RentalOffer | null>(null)
  const [seedVersion, setSeedVersion] = useState(0)
  const [guidedSeed, setGuidedSeed] = useState<GuidedDraft>(blankGuided)
  const [guidedResult, setGuidedResult] = useState<GuidedDraft | null>(null)
  const [offer, setOffer] = useState<RentalOffer | null>(null)
  const [evaluation, setEvaluation] = useState<RentalEvaluation | null>(null)
  const [evaluationProfileKey, setEvaluationProfileKey] = useState('')
  const [rentalA, setRentalA] = useState<RentalOffer | null>(null)
  const [rentalB, setRentalB] = useState<RentalOffer | null>(null)
  const [savedSlot, setSavedSlot] = useState<'A' | 'B' | null>(null)
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(blankProfile)
  const [profileEnabled, setProfileEnabled] = useState(false)
  const [profileEditing, setProfileEditing] = useState(false)
  const [demoCompare, setDemoCompare] = useState(false)
  const [operation, setOperation] = useState<Operation>(null)
  const [error, setError] = useState<string | null>(null)
  const [entryNotice, setEntryNotice] = useState<string | null>(null)
  const [stressError, setStressError] = useState<string | null>(null)
  const [stressResult, setStressResult] = useState<StressResult | null>(null)
  const [stressScenario, setStressScenario] = useState<StressScenario | null>(null)
  const [redactionOpen, setRedactionOpen] = useState(false)

  useEffect(() => {
    leaseServiceStatus().then(setStatus).catch(() => setStatus(null))
  }, [])

  let profile: FinancialProfile | undefined
  let profileError: string | null = null
  if (profileEnabled) {
    try { profile = profileToRequest(profileDraft) }
    catch (cause) { profileError = cause instanceof Error ? cause.message : 'Complete your financial profile.' }
  }
  const currentProfileKey = JSON.stringify(profileEnabled ? profileDraft : null)
  const profileChanged = Boolean(evaluation && currentProfileKey !== evaluationProfileKey)

  const evaluate = async (nextOffer: RentalOffer, nextProfile = profile, nextKey = currentProfileKey) => {
    if (operation) return
    if (profileEnabled && profileError && nextProfile === undefined && nextKey === currentProfileKey) { setError(profileError); return }
    setOperation('evaluate'); setError(null); setStressResult(null); setStressScenario(null)
    try {
      const result = await evaluateRental(nextOffer, nextProfile)
      setOffer(nextOffer); setEvaluation(result); setEvaluationProfileKey(nextKey); setStep('results'); setSavedSlot(null); setEntryNotice(null); setProfileEditing(false)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not evaluate this rental.') }
    finally { setOperation(null) }
  }
  const extractText = async (text: string) => {
    if (operation) return
    setOperation('extract'); setError(null)
    try { setDraft(await extractLeaseText(text)); setStep('review'); setEntryNotice(null) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Extraction failed.') }
    finally { setOperation(null) }
  }
  const receiveApprovedPdfDraft = (nextDraft: LeaseDraft) => {
    setEntry('lease'); setDraft(nextDraft); setStep('review'); setError(null); setEntryNotice(null)
    setOffer(null); setEvaluation(null); setStressResult(null); setStressScenario(null); setSavedSlot(null)
  }
  const confirm = async (decisions: ReviewDecision[]) => {
    if (!draft || operation) return
    setOperation('confirm'); setError(null)
    try {
      const confirmed = await confirmLease(draft, decisions)
      setOffer(confirmed.confirmed_offer); setDraft(null); setEvaluation(null); setStep('results'); setSavedSlot(null); setStressResult(null); setStressScenario(null)
      if (profileError) { setStep('results'); setEvaluation(null); setError(`Terms confirmed. ${profileError} Complete your profile, then evaluate.`); return }
      setOperation('evaluate')
      const result = await evaluateRental(confirmed.confirmed_offer, profile)
      setEvaluation(result); setEvaluationProfileKey(currentProfileKey)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not confirm or evaluate the reviewed terms.') }
    finally { setOperation(null) }
  }
  const runStress = async (scenario: StressScenario) => {
    if (!offer || operation || profileChanged) return
    setOperation('stress'); setStressError(null); setStressResult(null); setStressScenario(scenario)
    try { setStressResult(await stressRental(offer, scenario, profile)) }
    catch (cause) { setStressError(cause instanceof Error ? cause.message : 'Stress test unavailable.') }
    finally { setOperation(null) }
  }
  const demo = async (stayInCompare = false) => {
    if (operation) return
    setRedactionOpen(false)
    setDemoCompare(stayInCompare)
    setOffer(null); setEvaluation(null); setSeed(null); setSeedVersion(n => n + 1)
    setProfileDraft(blankProfile()); setProfileEnabled(false); setProfileEditing(false); setEntry('guided'); setGuidedSeed(sampleGuided()); setGuidedResult(null); setDraft(null); setError(null); setEntryNotice(null); setStressResult(null); setStressScenario(null); setSavedSlot(null)
    if (stayInCompare) { setDemoCompare(true); onNavigate('compare'); return }
    onNavigate('analyze'); setStep('entry')
  }
  const edit = (slot: 'A' | 'B') => {
    setRedactionOpen(false)
    setDemoCompare(false)
    const selected = slot === 'A' ? rentalA : rentalB
    setSeed(cameFromDocument(selected) ? null : selected); setSeedVersion(n => n + 1); setEntry('manual'); setStep('entry'); setError(null); setDraft(null)
    setEntryNotice(cameFromDocument(selected) ? 'This saved offer came from reviewed document terms. The manual form starts a new offer so it does not silently drop clauses or their provenance. The comparison slot stays in place until you save a replacement.' : null)
    onNavigate('analyze')
  }
  const save = (slot: 'A' | 'B') => {
    if (!offer) return
    if (slot === 'A') setRentalA(offer); else setRentalB(offer)
    setDemoCompare(false)
    setSavedSlot(slot)
  }
  const startManual = () => {
    setRedactionOpen(false)
    setSeed(null); setGuidedResult(null); setSeedVersion(n => n + 1); setEntry('manual'); setStep('entry'); setDraft(null); setError(null); setEntryNotice(null)
    setOffer(null); setEvaluation(null); setSavedSlot(null); setStressResult(null); setStressScenario(null); setDemoCompare(false)
  }
  const startGuided = () => {
    setRedactionOpen(false)
    setGuidedSeed(blankGuided()); setGuidedResult(null); setSeedVersion(n => n + 1); setEntry('guided'); setStep('entry'); setDraft(null); setError(null); setEntryNotice(null)
    setOffer(null); setEvaluation(null); setSavedSlot(null); setStressResult(null); setStressScenario(null); setDemoCompare(false)
    setProfileDraft(blankProfile()); setProfileEnabled(false); setProfileEditing(false)
  }
  const evaluateGuided = (nextOffer: RentalOffer, nextProfile?: FinancialProfile, answers?: GuidedDraft) => {
    const nextDraft = answers ?? blankGuided()
    const nextProfileDraft: ProfileDraft = { ...blankProfile(), income: nextDraft.income, savings: nextDraft.savings, essentials: nextDraft.essentials, reserve: nextDraft.reserve }
    setProfileDraft(nextProfileDraft); setProfileEnabled(Boolean(nextProfile)); setGuidedResult(nextDraft)
    void evaluate(nextOffer, nextProfile, JSON.stringify(nextProfile ? nextProfileDraft : null))
  }
  const startLease = () => {
    setRedactionOpen(false)
    setSeed(null); setGuidedResult(null); setSeedVersion(n => n + 1); setEntry('lease'); setLeaseMethod('text'); setStep('entry'); setDraft(null); setError(null); setEntryNotice(null)
    setOffer(null); setEvaluation(null); setSavedSlot(null); setStressResult(null); setStressScenario(null); setDemoCompare(false)
  }
  const editCurrent = () => {
    setRedactionOpen(false)
    if (entry === 'guided' && guidedResult) { setGuidedSeed(guidedResult); setSeedVersion(n => n + 1); setStep('entry'); setError(null); return }
    setStep('entry'); setEntry('manual'); setSeed(cameFromDocument(offer) ? null : offer); setSeedVersion(n => n + 1); setError(null)
    setEntryNotice(cameFromDocument(offer) ? 'This offer came from reviewed document terms. The manual form starts a new offer so it does not silently drop clauses or their provenance. Your confirmed offer remains available until you evaluate a replacement.' : null)
  }
  const progressLabels = entry === 'lease' ? [redactionOpen ? 'Approve redacted PDF' : 'Paste lease', 'Review findings', 'See costs', 'Explore scenarios'] : entry === 'guided' ? ['Guided questions', 'See costs', 'Explore scenarios'] : ['Enter details', 'See costs', 'Explore scenarios']
  const progressIndex = step === 'entry' ? 0 : step === 'review' ? 1 : step === 'results' ? (entry === 'lease' ? (stressResult ? 3 : 2) : (stressResult ? 2 : 1)) : -1

  return <main hidden={view === 'explore'} className="mx-auto max-w-[1380px] px-4 pb-12 pt-7 md:px-7">
    <div hidden={view !== 'analyze' || (redactionOpen && step !== 'review' && step !== 'results')} className="space-y-6">
      {step === 'start' && <section className="mx-auto max-w-4xl py-8 md:py-16"><div className="kicker">Analyze your next rental</div><h1 className="mt-3 max-w-3xl font-display text-4xl leading-tight md:text-5xl">Know what your rental will really cost.</h1><p className="mt-4 max-w-2xl text-base leading-relaxed text-muted">Answer a few simple questions to uncover upfront expenses, monthly costs, and financial risks before signing.</p><div className="mt-8 rounded-2xl border-2 border-forest bg-forest p-6 text-white shadow-lg md:p-8"><h2 className="font-display text-2xl">One clear path to your rental overview.</h2><p className="mt-2 max-w-xl text-sm text-white/80">Use the details you know. Unanswered costs stay marked uncertain, and personal finances are optional.</p><button type="button" onClick={startGuided} className="mt-6 min-h-12 rounded-xl bg-mint px-6 font-bold text-forest focus-visible:outline focus-visible:outline-4 focus-visible:outline-white">Start rental analysis</button></div><button type="button" onClick={() => void demo()} className="mt-5 min-h-11 text-sm font-semibold text-forest underline underline-offset-4 focus-visible:outline focus-visible:outline-4 focus-visible:outline-mint">Try with example data</button><p className="mt-2 text-xs text-muted">Example data is synthetic and does not describe a real listing or renter.</p><div className="mt-10 border-t border-line pt-5"><h2 className="font-display text-xl">Need to remove personal information first?</h2><p className="mt-1 max-w-2xl text-sm text-muted">Create a new PDF with selected personal identifiers permanently redacted. Review and download a redacted PDF, then optionally request AI findings from the approved version.</p><button type="button" onClick={() => { setStep('entry'); setRedactionOpen(true) }} className="mt-3 min-h-10 rounded-lg border border-forest px-4 text-sm font-bold text-forest focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest">Redact personal information from a lease PDF</button></div></section>}
      {step !== 'start' && <><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="kicker">Analyze · {step === 'review' ? 'Review findings' : step === 'results' ? 'Your result' : 'Rental details'}</div><p className="mt-1 text-sm text-muted">{step === 'review' ? 'Review every extracted term before calculating.' : step === 'results' ? 'Your calculation is ready. Edit terms or explore what-if scenarios.' : entry === 'lease' ? 'Upload a lease or paste its text for review.' : 'Start with the details you know; unknown costs stay marked unknown.'}</p></div><button type="button" className="min-h-10 rounded-xl border border-line px-4 text-sm font-bold" onClick={() => { if (step === 'review') { setStep('entry'); setError(null) } else { setStep('start'); setRedactionOpen(false) } }}>{step === 'review' ? '← Back to document' : '← All starting options'}</button></div><ol aria-label="Analyze progress" className="grid gap-2 sm:flex">{progressLabels.map((label,index) => <li key={label} aria-current={progressIndex === index ? 'step' : undefined} className={`flex-1 rounded-xl border px-3 py-2 text-xs font-bold ${progressIndex === index ? 'border-forest bg-forest text-white' : index < progressIndex ? 'border-[#b5d5c4] bg-mint text-forest' : 'border-line bg-white text-muted'}`}><span className="mr-2" aria-hidden="true">{index < progressIndex ? '✓' : index + 1}</span>{label}</li>)}</ol></>}
      {entry !== null && (step === 'start' || step === 'entry' || step === 'review') && <section hidden={step !== 'entry'} className="surface p-5 md:p-7">{entry !== 'guided' && <><h2 className="font-display text-2xl">{entry === 'lease' ? 'Analyze lease text with AI' : 'Enter rental details'}</h2>{entry === 'lease' && <p className="mt-2 text-sm text-muted">Gemini suggests costs and terms from pasted text. Review every finding before calculation. Text is sent to Google Gemini.</p>}<div className="mt-4 text-sm">{entry === 'lease' ? <button type="button" className="font-semibold text-forest underline" onClick={startGuided}>Switch to guided analysis</button> : status?.service_ready ? <button type="button" className="font-semibold text-forest underline" onClick={startLease}>Analyze lease text instead</button> : null}</div></>}{entry === 'guided' && <button type="button" className="text-sm font-semibold text-forest underline" onClick={startManual}>Use the detailed manual form instead</button>}{entry === 'guided' && status?.service_ready && <button type="button" className="ml-4 text-sm font-semibold text-forest underline" onClick={startLease}>Paste lease text with AI</button>}{entryNotice && <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{entryNotice}</p>}<div className="mt-6">{entry === 'guided' && <GuidedAdvisor key={seedVersion} initial={guidedSeed} busy={operation !== null} status={status} onEvaluate={evaluateGuided}/ >}{entry === 'manual' && <RentalInput key={seedVersion} seed={seed} busy={operation !== null} onEvaluate={next => void evaluate(next)}/ >}{entry === 'lease' && <LeaseInput key={leaseMethod} textOnly status={status} busy={operation === 'extract'} error={error} onText={text => void extractText(text)} onPdf={() => { setStep('entry'); setRedactionOpen(true) }} onManual={startGuided}/>}</div>{entry === 'manual' && error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}{entry === 'guided' && error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}</section>}
      {step === 'review' && draft && <section className="surface p-5 md:p-7"><p className="mb-4 text-xs text-muted">Source: {draft.source_type === 'pdf' ? (redactionOpen ? 'approved redacted PDF' : 'PDF') : 'pasted text'}. No terms are confirmed until you review and continue.</p><LeaseReview key={draft.draft_id} draft={draft} busy={operation === 'confirm'} error={error} onConfirm={decisions => void confirm(decisions)} onBack={() => { setStep('entry'); setError(null) }}/></section>}
      {step === 'results' && <div className="space-y-5">{profileChanged && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">Your financial profile changed. The figures below may be out of date. <button type="button" className="ml-2 font-bold underline" onClick={() => { if (offer) void evaluate(offer) }}>Refresh financial results</button></div>}{error && <p role="alert" className="text-sm text-red-800">{error} {offer && <button type="button" className="font-bold underline" onClick={() => void evaluate(offer)}>Retry evaluation</button>}</p>}{offer && evaluation && <><RentalOverview offer={offer} result={evaluation} profile={profile} status={status} profileStale={profileChanged}/><RentalResults offer={offer} result={evaluation} onSave={save} savedSlot={savedSlot} onEdit={editCurrent} onNew={() => { setRedactionOpen(false); setStep('start'); setEntry(null); setSeed(null); setSeedVersion(n => n + 1); setProfileEnabled(false); setProfileEditing(false); setProfileDraft(blankProfile()); setError(null) }} onCompare={() => { setDemoCompare(false); onNavigate('compare') }} onCompareDemo={() => { setDemoCompare(true); onNavigate('compare') }} isDemo={offer.rental_label === demoOffers[0].rental_label} profileStale={profileChanged} hasSavedA={rentalA !== null} hasSavedB={rentalB !== null} reviewedDocument={cameFromDocument(offer)}/> <section className="surface p-5" aria-label="Personal budget analysis"><div className="kicker">Optional · personal budget</div><h2 className="mt-1 font-display text-2xl">Can I comfortably afford this rental?</h2><p className="mt-2 text-sm text-muted">Add your take-home pay, expenses, and savings to see how this rental fits your budget.</p>{!profileEnabled && <button type="button" className="mt-4 min-h-11 rounded-xl bg-forest px-5 text-sm font-bold text-white" onClick={() => { setProfileEnabled(true); setProfileEditing(true) }}>Add my finances</button>}{profileEnabled && <><p className="mt-3 text-sm text-forest">{profileChanged ? 'Update the profile and refresh to recalculate affordability.' : evaluation.financial_profile ? `${evaluation.monthly_costs.monthly_costs_complete ? 'Monthly' : 'Known-term monthly'} cash left: ${money(evaluation.financial_profile.known_monthly_cash_remaining_after_housing_and_savings)} under this profile.${evaluation.monthly_costs.monthly_costs_complete ? '' : ' Unconfirmed housing costs are excluded.'}` : 'Complete your profile to calculate personalized cash flow.'}</p>{profileEditing && <FinancialProfileForm enabled value={profileDraft} onEnabled={enabled => { setProfileEnabled(enabled); setProfileEditing(enabled) }} onChange={setProfileDraft}/>}<div className="mt-3 flex flex-wrap gap-2">{profileEditing ? <button type="button" disabled={operation !== null || Boolean(profileError)} className="min-h-10 rounded-xl bg-forest px-4 text-sm font-bold text-white disabled:opacity-50" onClick={() => offer && void evaluate(offer)}>Update my finances</button> : <button type="button" className="min-h-10 rounded-xl border border-forest px-4 text-sm font-bold text-forest" onClick={() => setProfileEditing(true)}>Edit finances</button>}{profileError && <span role="alert" className="self-center text-sm text-red-800">{profileError}</span>}</div></>}</section><details className="surface p-5"><summary className="cursor-pointer font-display text-2xl">What if things don't go according to plan?</summary><p className="mt-2 text-sm text-muted">Explore how unexpected costs or changes in your living situation could affect your budget.</p>{!profileEnabled && <p className="mt-2 text-xs text-muted">Stress scenarios can run without a personal profile; add finances above for personalized savings impact.</p>}{!profileChanged && <RentalStressPanel key={offer.rental_label} offer={offer} profile={profile} status={status} scenario={stressScenario} busy={operation === 'stress'} error={stressError} result={stressResult} onRun={scenario => void runStress(scenario)} onScenarioEdit={() => { setStressResult(null); setStressScenario(null); setStressError(null) }}/>}</details></>}{offer && !evaluation && <button type="button" className="min-h-11 rounded-xl bg-forest px-5 text-sm font-bold text-white" onClick={() => void evaluate(offer)}>Evaluate confirmed offer</button>}</div>}
      <p className="text-xs leading-relaxed text-muted">Gemini extraction can be inaccurate. Missing fees stay unknown. Stress tests are hypothetical; lease interpretation is not legal advice.</p>
    </div>
    {view === 'analyze' && redactionOpen && <div hidden={step === 'review' || step === 'results'} className="space-y-6"><PdfRedactionWorkspace status={status} onBack={() => { setRedactionOpen(false); setStep('start') }} onGuided={startGuided} onExtracted={receiveApprovedPdfDraft} /></div>}
    <div hidden={view !== 'compare'}><RentalComparison a={demoCompare ? demoOffers[0] : rentalA} b={demoCompare ? demoOffers[1] : rentalB} profile={profile} profileError={profileError} status={status} onEdit={edit} onDemo={() => void demo(true)}/></div>
  </main>
}
