import { useEffect, useState } from 'react'
import { confirmLease, evaluateRental, extractLeasePdf, extractLeaseText, leaseServiceStatus, stressRental } from '../lib/rentalApi'
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

interface Props { view: ProductView; onNavigate: (view: ProductView) => void }
type Entry = 'manual' | 'lease' | null
type Step = 'start' | 'entry' | 'review' | 'results'
type Operation = 'extract' | 'confirm' | 'evaluate' | 'stress' | 'demo' | null
const cameFromDocument = (candidate: RentalOffer | null) => Boolean(candidate && 'base_rent_provenance' in candidate)

export function RentalWorkspace({ view, onNavigate }: Props) {
  const [entry, setEntry] = useState<Entry>(null)
  const [leaseMethod, setLeaseMethod] = useState<'text' | 'pdf'>('text')
  const [step, setStep] = useState<Step>('start')
  const [status, setStatus] = useState<LeaseServiceStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [draft, setDraft] = useState<LeaseDraft | null>(null)
  const [seed, setSeed] = useState<RentalOffer | null>(null)
  const [seedVersion, setSeedVersion] = useState(0)
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

  useEffect(() => {
    leaseServiceStatus().then(setStatus).catch(cause => setStatusError(cause instanceof Error ? cause.message : 'Could not check Gemini availability.'))
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
    if (profileEnabled && profileError && nextProfile === undefined) { setError(profileError); return }
    setOperation('evaluate'); setError(null); setStressResult(null)
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
  const extractPdf = async (file: File) => {
    if (operation) return
    setOperation('extract'); setError(null)
    try { setDraft(await extractLeasePdf(file)); setStep('review'); setEntryNotice(null) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'PDF extraction failed.') }
    finally { setOperation(null) }
  }
  const confirm = async (decisions: ReviewDecision[]) => {
    if (!draft || operation) return
    setOperation('confirm'); setError(null)
    try {
      const confirmed = await confirmLease(draft, decisions)
      setOffer(confirmed.confirmed_offer); setDraft(null); setEvaluation(null); setStep('results'); setSavedSlot(null); setStressResult(null)
      if (profileError) { setStep('results'); setEvaluation(null); setError(`Terms confirmed. ${profileError} Complete your profile, then evaluate.`); return }
      setOperation('evaluate')
      const result = await evaluateRental(confirmed.confirmed_offer, profile)
      setEvaluation(result); setEvaluationProfileKey(currentProfileKey)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not confirm or evaluate the reviewed terms.') }
    finally { setOperation(null) }
  }
  const runStress = async (scenario: StressScenario) => {
    if (!offer || operation || profileChanged) return
    setOperation('stress'); setStressError(null); setStressResult(null)
    try { setStressResult(await stressRental(offer, scenario, profile)) }
    catch (cause) { setStressError(cause instanceof Error ? cause.message : 'Stress test unavailable.') }
    finally { setOperation(null) }
  }
  const demo = async (stayInCompare = false) => {
    if (operation) return
    setDemoCompare(stayInCompare)
    setOffer(demoOffers[0]); setSeed(demoOffers[0]); setSeedVersion(n => n + 1)
    setProfileDraft(blankProfile()); setProfileEnabled(false); setProfileEditing(false); setEntry('manual'); setDraft(null); setError(null); setEntryNotice(null); setStressResult(null); setSavedSlot(null)
    if (stayInCompare) { setDemoCompare(true); onNavigate('compare'); return }
    onNavigate('analyze'); setOperation('demo')
    try { setEvaluation(await evaluateRental(demoOffers[0])); setEvaluationProfileKey(JSON.stringify(null)); setStep('results') }
    catch (cause) { setStep('entry'); setError(cause instanceof Error ? cause.message : 'Demo evaluation unavailable.') }
    finally { setOperation(null) }
  }
  const edit = (slot: 'A' | 'B') => {
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
    setSeed(null); setSeedVersion(n => n + 1); setEntry('manual'); setStep('entry'); setDraft(null); setError(null); setEntryNotice(null)
    setOffer(null); setEvaluation(null); setSavedSlot(null); setStressResult(null); setDemoCompare(false)
  }
  const startLease = () => {
    setSeed(null); setSeedVersion(n => n + 1); setEntry('lease'); setLeaseMethod('text'); setStep('entry'); setDraft(null); setError(null); setEntryNotice(null)
    setOffer(null); setEvaluation(null); setSavedSlot(null); setStressResult(null); setDemoCompare(false)
  }
  const editCurrent = () => {
    setStep('entry'); setEntry('manual'); setSeed(cameFromDocument(offer) ? null : offer); setSeedVersion(n => n + 1); setError(null)
    setEntryNotice(cameFromDocument(offer) ? 'This offer came from reviewed document terms. The manual form starts a new offer so it does not silently drop clauses or their provenance. Your confirmed offer remains available until you evaluate a replacement.' : null)
  }
  const progressLabels = entry === 'lease' ? ['Upload lease', 'Review findings', 'See costs', 'Explore scenarios'] : ['Enter details', 'See costs', 'Explore scenarios']
  const progressIndex = step === 'entry' ? 0 : step === 'review' ? 1 : step === 'results' ? (entry === 'lease' ? (stressResult ? 3 : 2) : (stressResult ? 2 : 1)) : -1

  return <main hidden={view === 'explore'} className="mx-auto max-w-[1380px] px-4 pb-12 pt-7 md:px-7">
    <div hidden={view !== 'analyze'} className="space-y-6">
      {step === 'start' && <section className="mx-auto max-w-5xl py-5 md:py-12"><div className="kicker">Analyze your next rental</div><h1 className="mt-3 max-w-3xl font-display text-4xl leading-tight md:text-5xl">Understand the real cost of your next rental.</h1><p className="mt-4 max-w-3xl text-base leading-relaxed text-muted">Find out what you'll pay upfront, what your lease could cost over time, and what happens if your circumstances change.</p>{operation === 'demo' && <p role="status" className="mt-4 rounded-xl border border-[#b5d5c4] bg-mint p-4 text-sm font-semibold text-forest">Calculating the sample rental costs…</p>}<div className="mt-8 grid gap-4 md:grid-cols-3"><button type="button" disabled={operation !== null} onClick={startLease} className="group min-h-56 rounded-2xl border-2 border-forest bg-forest p-6 text-left text-white shadow-lg transition hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-4 focus-visible:outline-mint disabled:opacity-60"><span className="text-xs font-bold uppercase tracking-widest text-mint">Analyze a lease with AI</span><span className="mt-4 block font-display text-2xl">Review the details before you decide.</span><span className="mt-3 block text-sm text-white/80">Upload a PDF or paste lease text. Gemini finds costs and terms for you to review.</span><span className="mt-5 block text-sm font-bold">Upload PDF or paste text →</span></button><button type="button" disabled={operation !== null} onClick={startManual} className="min-h-56 rounded-2xl border border-line bg-white p-6 text-left transition hover:border-forest hover:shadow-md focus-visible:outline focus-visible:outline-4 focus-visible:outline-mint disabled:opacity-60"><span className="text-xs font-bold uppercase tracking-widest text-forest">No lease yet?</span><span className="mt-4 block font-display text-2xl text-ink">Enter rental details</span><span className="mt-3 block text-sm leading-relaxed text-muted">Know the advertised rent and a few fees? Start with what you know.</span><span className="mt-5 block text-sm font-bold text-forest">Enter details →</span></button><button type="button" disabled={operation !== null} onClick={() => void demo()} className="min-h-56 rounded-2xl border border-line bg-white p-6 text-left transition hover:border-forest hover:shadow-md focus-visible:outline focus-visible:outline-4 focus-visible:outline-mint disabled:opacity-60"><span className="text-xs font-bold uppercase tracking-widest text-forest">Try it now</span><span className="mt-4 block font-display text-2xl text-ink">Try a sample rental</span><span className="mt-3 block text-sm leading-relaxed text-muted">Explore a realistic example without entering anything.</span><span className="mt-5 block text-sm font-bold text-forest">See a sample result →</span></button></div>{statusError && <p className="mt-5 text-sm text-muted">Gemini status could not be checked. Manual entry and the sample rental are available.</p>}</section>}
      {step !== 'start' && <><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="kicker">Analyze · {step === 'review' ? 'Review findings' : step === 'results' ? 'Your result' : 'Rental details'}</div><p className="mt-1 text-sm text-muted">{step === 'review' ? 'Review every extracted term before calculating.' : step === 'results' ? 'Your calculation is ready. Edit terms or explore what-if scenarios.' : entry === 'lease' ? 'Upload a lease or paste its text for review.' : 'Start with the details you know; unknown costs stay marked unknown.'}</p></div><button type="button" className="min-h-10 rounded-xl border border-line px-4 text-sm font-bold" onClick={() => { if (step === 'review') { setStep('entry'); setError(null) } else setStep('start') }}>{step === 'review' ? '← Back to document' : '← All starting options'}</button></div><ol aria-label="Analyze progress" className="grid gap-2 sm:flex">{progressLabels.map((label,index) => <li key={label} aria-current={progressIndex === index ? 'step' : undefined} className={`flex-1 rounded-xl border px-3 py-2 text-xs font-bold ${progressIndex === index ? 'border-forest bg-forest text-white' : index < progressIndex ? 'border-[#b5d5c4] bg-mint text-forest' : 'border-line bg-white text-muted'}`}><span className="mr-2" aria-hidden="true">{index < progressIndex ? '✓' : index + 1}</span>{label}</li>)}</ol></>}
      {entry !== null && (step === 'start' || step === 'entry' || step === 'review') && <section hidden={step !== 'entry'} className="surface p-5 md:p-7"><h2 className="font-display text-2xl">{entry === 'lease' ? 'Analyze a lease with AI' : 'Enter rental details'}</h2>{entry === 'lease' && <p className="mt-2 text-sm text-muted">Gemini looks for rent, fees, deposits, lease length, concessions, and conditions. AI can make mistakes; you review every finding before calculations. Your submitted lease text is sent to Google Gemini.</p>}<div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm">{entry === 'lease' ? <button type="button" className="font-semibold text-forest underline" onClick={startManual}>Switch to manual entry</button> : <button type="button" className="font-semibold text-forest underline" onClick={startLease}>Analyze a lease instead</button>}</div>
        {entryNotice && <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{entryNotice}</p>}
        <div className="mt-6">{entry === 'manual' && <RentalInput key={seedVersion} seed={seed} busy={operation !== null} onEvaluate={next => void evaluate(next)}/ >}{entry === 'lease' && <LeaseInput key={leaseMethod} initialMethod={leaseMethod} status={status} busy={operation === 'extract'} error={error} onText={text => void extractText(text)} onPdf={file => void extractPdf(file)}/>}</div>{entry === 'manual' && error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
      </section>}
      {step === 'review' && draft && <section className="surface p-5 md:p-7"><p className="mb-4 text-xs text-muted">Source: {draft.source_type === 'pdf' ? 'PDF' : 'pasted text'}. No terms are confirmed until you review and continue.</p><LeaseReview key={draft.draft_id} draft={draft} busy={operation === 'confirm'} error={error} onConfirm={decisions => void confirm(decisions)} onBack={() => { setStep('entry'); setError(null) }}/></section>}
      {step === 'results' && <div className="space-y-5">{profileChanged && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">Your financial profile changed. The figures below may be out of date. <button type="button" className="ml-2 font-bold underline" onClick={() => { if (offer) void evaluate(offer) }}>Refresh financial results</button></div>}{error && <p role="alert" className="text-sm text-red-800">{error} {offer && <button type="button" className="font-bold underline" onClick={() => void evaluate(offer)}>Retry evaluation</button>}</p>}{offer && evaluation && <><RentalResults offer={offer} result={evaluation} onSave={save} savedSlot={savedSlot} onEdit={editCurrent} onNew={() => { setStep('start'); setEntry(null); setSeed(null); setSeedVersion(n => n + 1); setProfileEnabled(false); setProfileEditing(false); setProfileDraft(blankProfile()); setError(null) }} onCompare={() => { setDemoCompare(false); onNavigate('compare') }} onCompareDemo={() => { setDemoCompare(true); onNavigate('compare') }} isDemo={offer.rental_label === demoOffers[0].rental_label} profileStale={profileChanged} hasSavedA={rentalA !== null} hasSavedB={rentalB !== null} reviewedDocument={cameFromDocument(offer)}/> <section className="surface p-5" aria-label="Personal budget analysis"><div className="kicker">Optional · personal budget</div><h2 className="mt-1 font-display text-2xl">Can I comfortably afford this rental?</h2><p className="mt-2 text-sm text-muted">Add your take-home pay, expenses, and savings to see how this rental fits your budget.</p>{!profileEnabled && <button type="button" className="mt-4 min-h-11 rounded-xl bg-forest px-5 text-sm font-bold text-white" onClick={() => { setProfileEnabled(true); setProfileEditing(true) }}>Add my finances</button>}{profileEnabled && <><p className="mt-3 text-sm text-forest">{profileChanged ? 'Update the profile and refresh to recalculate affordability.' : evaluation.financial_profile ? `${evaluation.monthly_costs.monthly_costs_complete ? 'Monthly' : 'Known-term monthly'} cash left: ${money(evaluation.financial_profile.known_monthly_cash_remaining_after_housing_and_savings)} under this profile.${evaluation.monthly_costs.monthly_costs_complete ? '' : ' Unconfirmed housing costs are excluded.'}` : 'Complete your profile to calculate personalized cash flow.'}</p>{profileEditing && <FinancialProfileForm enabled value={profileDraft} onEnabled={enabled => { setProfileEnabled(enabled); setProfileEditing(enabled) }} onChange={setProfileDraft}/>}<div className="mt-3 flex flex-wrap gap-2">{profileEditing ? <button type="button" disabled={operation !== null || Boolean(profileError)} className="min-h-10 rounded-xl bg-forest px-4 text-sm font-bold text-white disabled:opacity-50" onClick={() => offer && void evaluate(offer)}>Update my finances</button> : <button type="button" className="min-h-10 rounded-xl border border-forest px-4 text-sm font-bold text-forest" onClick={() => setProfileEditing(true)}>Edit finances</button>}{profileError && <span role="alert" className="self-center text-sm text-red-800">{profileError}</span>}</div></>}</section><details className="surface p-5"><summary className="cursor-pointer font-display text-2xl">What if things don't go according to plan?</summary><p className="mt-2 text-sm text-muted">Explore how unexpected costs or changes in your living situation could affect your budget.</p>{!profileEnabled && <p className="mt-2 text-xs text-muted">Stress scenarios can run without a personal profile; add finances above for personalized savings impact.</p>}{!profileChanged && <RentalStressPanel key={offer.rental_label} offer={offer} busy={operation === 'stress'} error={stressError} result={stressResult} onRun={scenario => void runStress(scenario)}/>}</details></>}{offer && !evaluation && <button type="button" className="min-h-11 rounded-xl bg-forest px-5 text-sm font-bold text-white" onClick={() => void evaluate(offer)}>Evaluate confirmed offer</button>}</div>}
      <p className="text-xs leading-relaxed text-muted">Gemini extraction can be inaccurate. Missing fees stay unknown. Stress tests are hypothetical; lease interpretation is not legal advice.</p>
    </div>
    <div hidden={view !== 'compare'}><RentalComparison a={demoCompare ? demoOffers[0] : rentalA} b={demoCompare ? demoOffers[1] : rentalB} profile={profile} profileError={profileError} onEdit={edit} onDemo={() => void demo(true)}/></div>
  </main>
}
