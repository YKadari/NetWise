import { ArrowDownRight, ArrowUpRight, Minus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { compareAreas } from '../lib/api'
import { bedroomLabels, distance, dollars } from '../lib/preferences'
import type { AreaComparisonResult, Bedroom, OptimizationResult } from '../types/api'

interface Props { ids: string[]; bedrooms: Bedroom; budget: number; optimization: OptimizationResult; onClose: () => void }

export function ComparisonDialog({ ids, bedrooms, budget, optimization, onClose }: Props) {
  const [comparison, setComparison] = useState<AreaComparisonResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(null)
    compareAreas(ids, bedrooms, controller.signal).then(setComparison).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Comparison could not load.')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [ids.join('|'), bedrooms])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const pareto = new Set(optimization.diagnostics.pareto_frontier_area_ids)
  const difference = comparison?.pairwise_differences[0]
  const left = comparison?.areas[0]
  const right = comparison?.areas[1]
  const numberDifference = (value: number | null, leftArea: string, rightArea: string, subject: 'rent' | 'Loop' | 'rail') => {
    if (value == null) return <span className="inline-flex items-center gap-1 text-muted"><Minus size={13}/> Difference unavailable</span>
    if (Math.abs(value) < 0.005) return <span className="inline-flex items-center gap-1 text-muted"><Minus size={13}/> Same measured value</span>
    const leftLeads = value < 0
    const area = leftLeads ? leftArea : rightArea
    const magnitude = subject === 'rent' ? dollars(Math.abs(value)) : distance(Math.abs(value))
    return <span className="inline-flex flex-wrap items-center gap-1 text-muted">{leftLeads ? <ArrowDownRight size={14} className="text-forest"/> : <ArrowUpRight size={14} className="text-forest"/>}<strong className="text-ink">ZIP {area}</strong> {subject === 'rent' ? `costs ${magnitude} less` : `is ${magnitude} closer to the ${subject}`}</span>
  }

  return <div className="fixed inset-0 z-[1200] flex items-end justify-center bg-ink/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-5" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section role="dialog" aria-modal="true" aria-labelledby="compare-title" className="max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-t-3xl bg-canvas p-5 shadow-2xl sm:rounded-3xl sm:p-7">
      <div className="flex items-start justify-between gap-4"><div><span className="kicker">Side by side</span><h2 id="compare-title" className="mt-1 font-display text-3xl text-ink">Compare two areas</h2><p className="mt-1 text-sm text-muted">Measured tradeoffs for the same bedroom size. Neither area is universally better.</p></div><button type="button" onClick={onClose} aria-label="Close comparison" className="rounded-full p-2 text-muted hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest"><X size={20}/></button></div>
      {loading && <p role="status" className="mt-8 py-8 text-center text-sm text-muted">Loading public area comparison…</p>}
      {error && <p role="alert" className="mt-6 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}
      {comparison && left && right && <>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-5">{[left,right].map(area => <article key={area.area_id} className="rounded-2xl border border-line bg-white p-4 sm:p-5"><div className="kicker text-muted">Chicago ZCTA</div><h3 className="mt-1 font-display text-2xl text-ink">ZIP {area.zip_code}</h3><div className="mt-3 text-xs font-semibold text-muted">HUD {bedroomLabels[bedrooms]} benchmark</div><div className="mt-1 text-2xl font-bold text-ink sm:text-3xl">{dollars(area.selected_hud_rent)}</div><div className={`mt-1 text-xs font-semibold ${(area.selected_hud_rent ?? Infinity) <= budget ? 'text-forest' : 'text-coral'}`}>{area.selected_hud_rent == null ? 'Benchmark unavailable' : (area.selected_hud_rent <= budget ? `${dollars(budget-area.selected_hud_rent)} under stated budget` : `${dollars(area.selected_hud_rent-budget)} above stated budget`)}</div><span className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${pareto.has(area.area_id) ? 'bg-mint text-forest' : 'bg-canvas text-muted'}`}>{pareto.has(area.area_id) ? 'Efficient tradeoff' : 'Not on current efficient set'}</span>
          <dl className="mt-5 space-y-3 border-t border-line pt-4 text-sm"><div><dt className="text-xs text-muted">Straight-line to Loop</dt><dd className="font-semibold text-ink">{distance(area.workplace_distance_km)}</dd></div><div><dt className="text-xs text-muted">Nearest CTA rail</dt><dd className="font-semibold text-ink">{area.nearest_cta_station_name || 'Not available'} · {distance(area.nearest_cta_station_km)}</dd></div><div><dt className="text-xs text-muted">Stations within 2 km</dt><dd className="font-semibold text-ink">{area.cta_stations_within_2km ?? 'Not available'}</dd></div></dl>
          <div className="mt-5 border-t border-line pt-4"><div className="text-xs font-semibold text-muted">All HUD monthly benchmarks</div><div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-5">{[area.hud_studio_rent,area.hud_1br_rent,area.hud_2br_rent,area.hud_3br_rent,area.hud_4br_rent].map((rent,i)=><div key={i} className="rounded-lg bg-canvas p-2 text-center"><div className="text-[10px] text-muted">{['Studio','1 bed','2 bed','3 bed','4 bed'][i]}</div><div className="mt-1 text-xs font-bold text-ink">{dollars(rent)}</div></div>)}</div></div>
          {area.google_maps_directions_url && <a href={area.google_maps_directions_url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-10 items-center rounded-lg px-1 text-sm font-bold text-forest underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest">Directions in Google Maps ↗</a>}
        </article>)}</div>
        {difference && <section className="mt-5 rounded-2xl border border-line bg-white p-4 sm:p-5" aria-label="Measured differences"><h3 className="font-bold text-ink">How the measurements differ</h3><div className="mt-3 grid gap-3 text-sm sm:grid-cols-3"><p>{numberDifference(difference.selected_hud_rent_difference_left_minus_right,left.zip_code,right.zip_code,'rent')}</p><p>{numberDifference(difference.workplace_distance_km_difference_left_minus_right,left.zip_code,right.zip_code,'Loop')}</p><p>{numberDifference(difference.nearest_cta_station_km_difference_left_minus_right,left.zip_code,right.zip_code,'rail')}</p></div><p className="mt-3 text-sm leading-relaxed text-muted">These are measured cost and straight-line distance differences. They do not rate neighborhood quality or predict apartment availability or commute times.</p></section>}
        <p className="mt-4 text-xs leading-relaxed text-muted">Census ZCTAs approximate postal ZIP geography. HUD benchmarks are not listings; distances are straight-line. {left.source_and_measurement_limitations[0] || ''}</p>
      </>}
      <div className="mt-6 flex justify-end"><button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-line bg-white px-5 py-2.5 text-sm font-bold text-ink hover:bg-canvas focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest">Back to exploring</button></div>
    </section>
  </div>
}
