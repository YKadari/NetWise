import { ArrowUpRight, BriefcaseBusiness, Info, TrainFront } from 'lucide-react'
import type { Bedroom, OptimizationResult } from '../types/api'
import { distance, dollars } from '../lib/preferences'

interface Props {
  result: OptimizationResult
  bedrooms: Bedroom
  selectedId: string | null
  comparedIds: string[]
  onSelect: (id: string) => void
  onCompare: (id: string) => void
  pending: boolean
}

export function RecommendationsPanel({ result, bedrooms, selectedId, comparedIds, onSelect, onCompare, pending }: Props) {
  const { summary, recommendations } = result
  return <section className="surface flex min-h-[400px] flex-col overflow-hidden" aria-label="Recommendations">
    <div className="border-b border-line p-5 md:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><span className="kicker">Your shortlist</span><h2 className="mt-1 font-display text-2xl text-ink md:text-3xl">Places to consider</h2><p className="mt-2 text-sm text-muted"><strong className="text-ink">{summary.eligible_count} of {summary.total_areas_evaluated}</strong> areas meet your requirements · <strong className="text-ink">{summary.pareto_efficient_count}</strong> efficient tradeoffs</p></div>{pending && <span role="status" className="text-xs font-medium text-forest">Updating…</span>}</div>
      <details className="group mt-3"><summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-forest focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest"><Info size={14}/> What makes a tradeoff efficient?</summary><div className="mt-2 rounded-xl bg-canvas p-3 text-sm leading-relaxed text-muted">An efficient tradeoff: no other qualifying area is better on every measured objective. We compare HUD rent, straight-line distance to the Loop, and straight-line distance to rail. <span className="mt-1 block text-xs">The optimizer first finds the efficient set, then orders it by your chosen priorities. This does not rate neighborhood quality.</span></div></details>
    </div>
    {recommendations.length === 0 ? <div className="flex flex-1 flex-col items-center justify-center p-8 text-center"><h3 className="font-display text-xl text-ink">No areas match yet</h3><p className="mt-2 max-w-xs text-sm leading-relaxed text-muted">Try raising your budget or loosening a distance limit, then update your results.</p></div> : <div className="divide-y divide-line xl:max-h-[calc(100vh-380px)] xl:overflow-y-auto">{recommendations.map((area, index) => {
      const compared = comparedIds.includes(area.area_id)
      return <article key={area.area_id} className={`p-4 transition md:p-5 ${selectedId === area.area_id ? 'bg-[#f3f8f4]' : compared ? 'bg-[#f7f5ed]' : 'bg-white'}`}>
        <button type="button" onClick={() => onSelect(area.area_id)} aria-pressed={selectedId === area.area_id} className="block w-full rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest"><div className="flex items-start justify-between gap-3"><div><span className="kicker text-muted">#{index + 1} recommendation</span><h3 className="mt-1 font-display text-2xl text-ink">ZIP {area.zip_code}</h3></div><ArrowUpRight size={18} className="mt-1 text-forest"/></div>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1"><span className="text-2xl font-bold text-ink">{dollars(area.hud_monthly_rent)}</span><span className="text-sm text-muted">HUD {bedrooms === 0 ? 'studio' : `${bedrooms}-bedroom`} rent benchmark / month</span></div>
          <div className={`mt-1 text-sm font-semibold ${area.budget_difference >= 0 ? 'text-forest' : 'text-coral'}`}>{area.budget_difference >= 0 ? `${dollars(area.budget_difference)} below budget` : `${dollars(-area.budget_difference)} above budget`}</div>
          <div className="mt-4 grid grid-cols-1 gap-2 text-sm text-muted sm:grid-cols-2"><span className="flex items-center gap-2"><BriefcaseBusiness size={16} className="shrink-0 text-forest"/><span>Loop: <strong className="text-ink">{distance(area.workplace_distance_km)}</strong> straight-line</span></span><span className="flex items-center gap-2"><TrainFront size={16} className="shrink-0 text-forest"/><span>CTA rail: <strong className="text-ink">{distance(area.nearest_cta_station_km)}</strong> straight-line</span></span></div>
          <p className="mt-2 text-sm text-muted">Nearest station: <strong className="font-semibold text-ink">{area.nearest_cta_station_name || 'Not available'}</strong></p>
          {area.pareto_efficient && <span className="mt-3 inline-flex rounded-full bg-mint px-3 py-1.5 text-xs font-bold text-forest">Efficient tradeoff</span>}
          <p className="mt-3 text-sm leading-relaxed text-muted"><strong className="font-semibold text-ink">Why this area?</strong> {area.explanation}</p>
        </button>
        <button type="button" aria-pressed={compared} onClick={() => onCompare(area.area_id)} className={`mt-3 min-h-10 rounded-lg border px-3 py-2 text-xs font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest ${compared ? 'border-forest bg-mint text-forest' : 'border-line bg-white text-ink hover:border-forest'}`}>{compared ? 'Remove from comparison' : 'Add to comparison'}</button>
      </article>
    })}</div>}
  </section>
}
