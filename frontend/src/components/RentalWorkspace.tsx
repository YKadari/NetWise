import { useEffect, useState } from 'react'
import { confirmLease, evaluateRental, extractLeasePdf, extractLeaseText, leaseServiceStatus, stressRental } from '../lib/rentalApi'
import { blankProfile, demoOffers, demoProfile, profileToRequest, type ProfileDraft } from '../lib/rentalForms'
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
type Step = 'entry' | 'review' | 'results'
type Operation = 'extract' | 'confirm' | 'evaluate' | 'stress' | 'demo' | null
const cameFromDocument = (candidate: RentalOffer | null) => Boolean(candidate && 'base_rent_provenance' in candidate)

export function RentalWorkspace({ view, onNavigate }: Props) {
  const [entry, setEntry] = useState<Entry>(null)
  const [leaseMethod, setLeaseMethod] = useState<'text' | 'pdf'>('text')
  const [step, setStep] = useState<Step>('entry')
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
      setOffer(nextOffer); setEvaluation(result); setEvaluationProfileKey(nextKey); setStep('results'); setSavedSlot(null); setEntryNotice(null)
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
    setRentalA(demoOffers[0]); setRentalB(demoOffers[1]); setOffer(demoOffers[0]); setSeed(demoOffers[0]); setSeedVersion(n => n + 1)
    setProfileDraft(demoProfile); setProfileEnabled(true); setEntry('manual'); setDraft(null); setError(null); setEntryNotice(null); setStressResult(null); setSavedSlot(null)
    if (stayInCompare) { onNavigate('compare'); return }
    onNavigate('analyze'); setOperation('demo')
    try { setEvaluation(await evaluateRental(demoOffers[0], profileToRequest(demoProfile))); setEvaluationProfileKey(JSON.stringify(demoProfile)); setStep('results') }
    catch (cause) { setStep('entry'); setError(cause instanceof Error ? cause.message : 'Demo evaluation unavailable.') }
    finally { setOperation(null) }
  }
  const edit = (slot: 'A' | 'B') => {
    const selected = slot === 'A' ? rentalA : rentalB
    setSeed(cameFromDocument(selected) ? null : selected); setSeedVersion(n => n + 1); setEntry('manual'); setStep('entry'); setError(null); setDraft(null)
    setEntryNotice(cameFromDocument(selected) ? 'This saved offer came from reviewed document terms. The manual form starts a new offer so it does not silently drop clauses or their provenance. The comparison slot stays in place until you save a replacement.' : null)
    onNavigate('analyze')
  }
  const save = (slot: 'A' | 'B') => {
    if (!offer) return
    if (slot === 'A') setRentalA(offer); else setRentalB(offer)
    setSavedSlot(slot)
  }

  return <main hidden={view === 'explore'} className="mx-auto max-w-[1380px] px-4 pb-12 pt-7 md:px-7">
    <div hidden={view !== 'analyze'} className="space-y-6"><div className="flex flex-wrap items-end justify-between gap-4"><div><div className="kicker">Analyze</div><h1 className="mt-1 font-display text-3xl md:text-4xl">Know what this rental asks of you.</h1><p className="mt-2 max-w-2xl text-sm text-muted">Enter terms yourself or review candidate terms extracted from a lease. Then see the cash commitment month by month.</p></div><button type="button" className="min-h-11 rounded-xl border border-forest px-4 text-sm font-bold text-forest" onClick={() => void demo()}>Try a synthetic demo</button></div>
      {statusError && <p className="text-xs text-muted">Gemini status could not be checked. Manual rental entry is available.</p>}
      <div aria-label="Analyze progress" className="grid grid-cols-3 gap-2 text-center text-xs font-bold sm:max-w-xl">{['1 · Provide terms', '2 · Review if extracted', '3 · See calculations'].map((label, index) => <div key={label} className={`rounded-xl px-2 py-3 ${index === (step === 'entry' ? 0 : step === 'review' ? 1 : 2) ? 'bg-forest text-white' : 'bg-white text-muted'}`}>{label}</div>)}</div>
      <FinancialProfileForm enabled={profileEnabled} value={profileDraft} onEnabled={setProfileEnabled} onChange={setProfileDraft}/>
      {step === 'entry' && <section className="surface p-5 md:p-7"><h2 className="font-display text-2xl">Start with the rental terms</h2><div className="mt-4 grid gap-3 sm:grid-cols-3"><button type="button" aria-pressed={entry === 'manual'} onClick={() => { setEntry('manual'); setError(null) }} className={`min-h-24 rounded-xl border p-4 text-left ${entry === 'manual' ? 'border-forest bg-mint' : 'border-line hover:border-forest'}`}><strong className="block">Enter details manually</strong><span className="mt-1 block text-xs text-muted">Works without Gemini</span></button><button type="button" aria-pressed={entry === 'lease' && leaseMethod === 'text'} onClick={() => { setLeaseMethod('text'); setEntry('lease'); setError(null) }} className={`min-h-24 rounded-xl border p-4 text-left ${entry === 'lease' && leaseMethod === 'text' ? 'border-forest bg-mint' : 'border-line hover:border-forest'}`}><strong className="block">Paste lease text</strong><span className="mt-1 block text-xs text-muted">Extract then review</span></button><button type="button" aria-pressed={entry === 'lease' && leaseMethod === 'pdf'} onClick={() => { setLeaseMethod('pdf'); setEntry('lease'); setError(null) }} className={`min-h-24 rounded-xl border p-4 text-left ${entry === 'lease' && leaseMethod === 'pdf' ? 'border-forest bg-mint' : 'border-line hover:border-forest'}`}><strong className="block">Upload a PDF</strong><span className="mt-1 block text-xs text-muted">Up to 10 MB and 80 pages</span></button></div>
        {entryNotice && <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{entryNotice}</p>}
        <div className="mt-6">{entry === 'manual' && <RentalInput key={seedVersion} seed={seed} busy={operation !== null} onEvaluate={next => void evaluate(next)}/ >}{entry === 'lease' && <LeaseInput key={leaseMethod} initialMethod={leaseMethod} status={status} busy={operation === 'extract'} error={error} onText={text => void extractText(text)} onPdf={file => void extractPdf(file)}/>}</div>{entry === 'manual' && error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
      </section>}
      {step === 'review' && draft && <section className="surface p-5 md:p-7"><div className="kicker">Gemini candidate terms</div><h2 className="mt-1 font-display text-2xl">Review each extracted field</h2><p className="mt-2 mb-5 text-sm text-muted">Source: {draft.source_type === 'pdf' ? 'PDF' : 'pasted text'}. The draft is unconfirmed until you submit all review decisions.</p><LeaseReview draft={draft} busy={operation === 'confirm'} error={error} onConfirm={decisions => void confirm(decisions)} onBack={() => { setStep('entry'); setError(null) }}/></section>}
      {step === 'results' && <div className="space-y-5"><div className="flex flex-wrap gap-3"><button type="button" className="min-h-11 rounded-xl border border-line px-4 text-sm font-bold" onClick={() => { setStep('entry'); setEntry('manual'); setSeed(cameFromDocument(offer) ? null : offer); setSeedVersion(n => n + 1); setError(null); setEntryNotice(cameFromDocument(offer) ? 'This offer came from reviewed document terms. The manual form starts a new offer so it does not silently drop clauses or their provenance. Your confirmed offer remains available until you evaluate a replacement.' : null) }}>{cameFromDocument(offer) ? 'Start new manual offer' : 'Edit rental terms'}</button><button type="button" className="min-h-11 rounded-xl border border-line px-4 text-sm font-bold" onClick={() => onNavigate('compare')}>Compare saved rentals</button></div>{profileChanged && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">Your financial profile changed after this calculation. Refresh before running a stress scenario. <button type="button" className="ml-2 font-bold underline" onClick={() => { if (offer) void evaluate(offer) }}>Refresh financial results</button></div>}{error && <p role="alert" className="text-sm text-red-800">{error} {offer && <button type="button" className="font-bold underline" onClick={() => void evaluate(offer)}>Retry evaluation</button>}</p>}{offer && evaluation && <><RentalResults offer={offer} result={evaluation} onSave={save} savedSlot={savedSlot}/>{!profileChanged && <RentalStressPanel key={offer.rental_label} offer={offer} busy={operation === 'stress'} error={stressError} result={stressResult} onRun={scenario => void runStress(scenario)}/>}</>}{offer && !evaluation && <button type="button" className="min-h-11 rounded-xl bg-forest px-5 text-sm font-bold text-white" onClick={() => void evaluate(offer)}>Evaluate confirmed offer</button>}</div>}
      <p className="text-xs leading-relaxed text-muted">Gemini extraction can be inaccurate. Missing fees stay unknown. Stress tests are hypothetical; lease interpretation is not legal advice.</p>
    </div>
    <div hidden={view !== 'compare'}><RentalComparison a={rentalA} b={rentalB} profile={profile} profileError={profileError} onEdit={edit} onDemo={() => void demo(true)}/></div>
  </main>
}
