import { useCallback, useEffect, useRef, useState } from 'react'
import { Layers3, MapPinned, SlidersHorizontal, Sparkles } from 'lucide-react'
import { analyzeSensitivity, getArea, getAreas, getHousing, getStations, optimize } from './lib/api'
import { defaultForm, toPreferences, toggleComparedAreas, type FormValues } from './lib/preferences'
import type { Area, FeatureCollection, HousingProperties, OptimizationResult, Preferences, SensitivityResult, StationProperties } from './types/api'
import { Header } from './components/Header'
import { PreferencesPanel } from './components/PreferencesPanel'
import { HousingMap } from './components/HousingMap'
import { RecommendationsPanel } from './components/RecommendationsPanel'
import { AreaDetails } from './components/AreaDetails'
import { SensitivityPanel } from './components/SensitivityPanel'
import { ComparisonDialog } from './components/ComparisonDialog'

interface Data { areas: Area[]; housing: FeatureCollection<HousingProperties>; stations: FeatureCollection<StationProperties> }

export default function App() {
  const [form, setForm] = useState<FormValues>(defaultForm)
  const [applied, setApplied] = useState<Preferences>(toPreferences(defaultForm))
  const [data, setData] = useState<Data | null>(null)
  const [result, setResult] = useState<OptimizationResult | null>(null)
  const [sensitivity, setSensitivity] = useState<SensitivityResult | null>(null)
  const [selectedSensitivityBudget, setSelectedSensitivityBudget] = useState<number | null>(null)
  const [sensitivityLoading, setSensitivityLoading] = useState(false)
  const [sensitivityError, setSensitivityError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Area | null>(null)
  const [comparedIds, setComparedIds] = useState<string[]>([])
  const [comparisonOpen, setComparisonOpen] = useState(false)
  const [showStations, setShowStations] = useState(false)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [resetMap, setResetMap] = useState(0)
  const [mobileView, setMobileView] = useState<'map' | 'results'>('map')
  const [mobilePreferencesOpen, setMobilePreferencesOpen] = useState(false)
  const [compact, setCompact] = useState(typeof window !== 'undefined' && window.innerWidth < 1024)
  const requestRef = useRef<AbortController | null>(null)
  const detailRef = useRef<AbortController | null>(null)
  const sensitivityRef = useRef<AbortController | null>(null)
  const dirty = JSON.stringify(toSafePreference(form)) !== JSON.stringify(applied)

  useEffect(() => { setSelectedSensitivityBudget(null) }, [form.bedrooms, form.budget, form.maxLoop, form.maxStation, form.hardBudget])

  useEffect(() => {
    const update = () => setCompact(window.innerWidth < 1024)
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(null)
    Promise.all([getAreas(controller.signal), getHousing(controller.signal), getStations(controller.signal), optimize(toPreferences(defaultForm), controller.signal)])
      .then(([areas, housing, stations, initial]) => {
        const areaIds = new Set(areas.map(a => a.area_id))
        if (housing.features.length !== areas.length || housing.features.some(f => !areaIds.has(f.properties.area_id))) throw new Error('Map areas do not match the public area data.')
        setData({ areas, housing, stations }); setResult(initial)
      })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load housing data.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [retry])

  useEffect(() => {
    if (!data) return
    sensitivityRef.current?.abort()
    const controller = new AbortController()
    sensitivityRef.current = controller
    setSensitivity(null)
    setSensitivityLoading(true); setSensitivityError(null)
    analyzeSensitivity(applied, controller.signal).then(value => {
      if (!controller.signal.aborted) setSensitivity(value)
    }).catch(cause => {
      if (!controller.signal.aborted) setSensitivityError(cause instanceof Error ? cause.message : 'Could not load sensitivity.')
    }).finally(() => { if (!controller.signal.aborted) setSensitivityLoading(false) })
    return () => controller.abort()
  }, [data, applied])

  const runOptimization = useCallback(async (next: Preferences) => {
    if (!data) return
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setPending(true); setError(null); setNotice(null)
    try {
      const response = await optimize(next, controller.signal)
      if (controller.signal.aborted) return
      setApplied(next); setResult(response)
      if (selectedId && !response.diagnostics.eligible_candidates.some(a => a.area_id === selectedId)) {
        setSelectedId(null); setDetail(null)
        setNotice('Your selected area no longer meets these requirements. Choose another area from the map or shortlist.')
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not update results.')
    } finally { if (!controller.signal.aborted) setPending(false) }
  }, [data, selectedId])

  const apply = useCallback(async () => {
    try { await runOptimization(toPreferences(form)) } catch { /* Validation is displayed beside the form. */ }
  }, [form, runOptimization])

  const applySuggestedBudget = useCallback(async (budget: number) => {
    const suggested = { ...form, budget: String(budget) }
    setForm(suggested)
    try { await runOptimization(toPreferences(suggested)) } catch { /* API-provided threshold is already validated. */ }
  }, [form, runOptimization])

  const selectArea = useCallback(async (areaId: string) => {
    if (compact) setMobileView('map')
    detailRef.current?.abort()
    const controller = new AbortController()
    detailRef.current = controller
    setSelectedId(areaId); setDetail(null); setNotice(null)
    try { const area = await getArea(areaId, controller.signal); if (!controller.signal.aborted) setDetail(area) }
    catch (cause) { if (!controller.signal.aborted) setNotice(cause instanceof Error ? cause.message : 'Could not load area details.') }
  }, [compact])

  const toggleCompare = useCallback((areaId: string) => {
    const next = toggleComparedAreas(comparedIds, areaId)
    setComparedIds(next.ids)
    if (next.replacedAreaId) setNotice(`Comparison updated: ZIP ${areaId.slice(5)} replaced ZIP ${next.replacedAreaId.slice(5)}.`)
  }, [comparedIds])

  const eligibleIds = new Set(result?.diagnostics.eligible_candidates.map(a => a.area_id) ?? [])
  const currentSensitivity = sensitivity && samePreferences(sensitivity.preferences, applied) ? sensitivity : null
  const preferences = <PreferencesPanel form={form} onChange={setForm} onApply={apply} pending={pending} dirty={dirty}/> 

  return <div className="min-h-screen bg-canvas text-ink"><Header/><main className="mx-auto max-w-[1800px] px-4 pb-10 pt-5 md:px-7 lg:px-8">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><div className="kicker text-forest">Chicago housing explorer</div><h1 className="mt-1 font-display text-3xl leading-tight text-ink md:text-4xl">A clearer way to find your fit.</h1><p className="mt-2 text-base text-muted">Set your priorities, explore Chicago areas, and compare the tradeoffs.</p></div>{data && <div className="rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-muted">{data.areas.length} Chicago ZCTAs</div>}</div>
    {compact && data && <nav className="mb-4 grid grid-cols-3 gap-2" aria-label="Explorer sections"><button type="button" onClick={() => setMobilePreferencesOpen(value => !value)} aria-expanded={mobilePreferencesOpen} className={`min-h-11 rounded-xl border px-3 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest ${mobilePreferencesOpen ? 'border-forest bg-mint text-forest' : 'border-line bg-white text-ink'}`}><SlidersHorizontal size={15} className="mr-1.5 inline"/>Filters</button><button type="button" aria-pressed={mobileView === 'map'} onClick={() => setMobileView('map')} className={`min-h-11 rounded-xl border px-3 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest ${mobileView === 'map' ? 'border-forest bg-forest text-white' : 'border-line bg-white text-ink'}`}><MapPinned size={15} className="mr-1.5 inline"/>Map</button><button type="button" aria-pressed={mobileView === 'results'} onClick={() => setMobileView('results')} className={`min-h-11 rounded-xl border px-3 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest ${mobileView === 'results' ? 'border-forest bg-forest text-white' : 'border-line bg-white text-ink'}`}><Sparkles size={15} className="mr-1.5 inline"/>Results</button></nav>}
    {loading && <div role="status" className="surface flex min-h-[420px] flex-col items-center justify-center p-10 text-center"><div className="text-forest"><Layers3 size={27}/></div><h2 className="mt-4 font-display text-2xl">Loading Chicago housing data</h2><p className="mt-2 text-base text-muted">Bringing the map and public benchmarks together…</p></div>}
    {!loading && !data && <div role="alert" className="surface mx-auto max-w-xl p-8 text-center"><h2 className="font-display text-2xl">The explorer could not connect</h2><p className="mt-3 text-base text-muted">{error || 'Public housing data is unavailable.'}</p><button className="mt-5 min-h-11 rounded-xl bg-forest px-5 py-3 text-sm font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest" onClick={() => setRetry(n => n + 1)}>Try again</button><p className="mt-4 text-sm text-muted">Make sure FastAPI is running at 127.0.0.1:8000.</p></div>}
    {data && result && <div className="grid grid-cols-1 gap-5 lg:grid-cols-[290px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_390px]">
      <div className={`${compact && !mobilePreferencesOpen ? 'hidden' : ''} lg:row-span-2 xl:row-span-1`}>{preferences}</div>
      <div className={`${compact && mobileView !== 'map' ? 'hidden' : ''} space-y-5`}>
        <section aria-label="Map of Chicago areas"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-xl font-bold">Explore Chicago</h2><p className="text-sm text-muted">Select a ZIP to view its measured tradeoffs.</p></div><div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => setResetMap(n => n + 1)} className="min-h-10 rounded-full border border-line bg-white px-3 text-sm font-semibold text-ink hover:border-forest focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest">Full Chicago view</button><button type="button" aria-pressed={showStations} onClick={() => setShowStations(value => !value)} className={`flex min-h-10 items-center gap-2 rounded-full border px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest ${showStations ? 'border-forest bg-mint text-forest' : 'border-line bg-white text-muted'}`}><Layers3 size={16}/> CTA stations {showStations ? 'on' : 'off'}</button></div></div><div className="mb-2 flex items-center gap-2"><label htmlFor="area-jump" className="text-sm font-semibold text-muted">Jump to ZIP</label><select id="area-jump" value={selectedId ?? ''} onChange={event => { if (event.target.value) void selectArea(event.target.value) }} className="min-h-10 rounded-lg border border-line bg-white px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest"><option value="">Choose an area</option>{[...data.areas].sort((a,b) => a.zip_code.localeCompare(b.zip_code)).map(area => <option key={area.area_id} value={area.area_id}>{area.zip_code}</option>)}</select></div><HousingMap areas={data.areas} housing={data.housing} stations={data.stations} eligibleIds={eligibleIds} selectedId={selectedId} comparedIds={comparedIds} resetKey={resetMap} bedrooms={applied.bedrooms} showStations={showStations} onSelect={selectArea}/><p className="mt-2 text-sm leading-relaxed text-muted">Census ZCTAs approximate postal ZIP areas. Distances show straight-line proximity from area points.</p></section>
        {selectedId && detail && <AreaDetails area={detail} bedrooms={applied.bedrooms} budget={applied.monthly_budget} result={result} compared={comparedIds.includes(selectedId)} onCompare={() => toggleCompare(selectedId)} onClose={() => { setSelectedId(null); setDetail(null) }}/>}
        {notice && <div role="status" className="rounded-xl border border-line bg-white p-3 text-sm text-muted">{notice}</div>}
        <SensitivityPanel result={currentSensitivity} loading={sensitivityLoading} applying={pending} error={sensitivityError} selectedBudget={selectedSensitivityBudget} onSelectBudget={setSelectedSensitivityBudget} onApplyBudget={applySuggestedBudget}/>
      </div>
      <div className={`${compact && mobileView !== 'results' ? 'hidden' : ''} space-y-5 lg:col-span-2 xl:col-span-1 xl:row-span-2`}>
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error} <button type="button" className="font-bold underline" onClick={apply}>Retry</button></div>}
        <div className="surface p-4 md:p-5" aria-label="Area comparison selection"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="kicker">Compare areas</div><p className="mt-1 text-sm text-muted">{comparedIds.length === 0 ? 'Add two ZIPs to compare their rent and distances.' : comparedIds.map(id => id.slice(5)).join('  ↔  ')}</p></div>{comparedIds.length === 2 && <button type="button" onClick={() => setComparisonOpen(true)} className="min-h-11 rounded-xl bg-ink px-4 py-2.5 text-sm font-bold text-white hover:bg-forest focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest">Compare these ZIPs</button>}</div></div>
        <RecommendationsPanel result={result} bedrooms={applied.bedrooms} selectedId={selectedId} comparedIds={comparedIds} onSelect={selectArea} onCompare={toggleCompare} pending={pending}/>
        {compact && mobileView === 'results' && <SensitivityPanel result={currentSensitivity} loading={sensitivityLoading} applying={pending} error={sensitivityError} selectedBudget={selectedSensitivityBudget} onSelectBudget={setSelectedSensitivityBudget} onApplyBudget={applySuggestedBudget}/>}
      </div>
    </div>}
    {comparisonOpen && result && <ComparisonDialog ids={comparedIds} bedrooms={applied.bedrooms} budget={applied.monthly_budget} optimization={result} onClose={() => setComparisonOpen(false)}/>}
  </main><footer className="border-t border-line px-5 py-5 text-center text-sm text-muted">NestWise · Chicago housing pilot · HUD benchmarks are not rental listings.</footer></div>
}

function toSafePreference(form: FormValues): Preferences | null {
  try { return toPreferences(form) } catch { return null }
}

function samePreferences(left: Preferences, right: Preferences): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  return [...keys].every(key => (left[key as keyof Preferences] ?? null) === (right[key as keyof Preferences] ?? null))
}
