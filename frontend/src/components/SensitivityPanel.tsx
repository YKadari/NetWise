import { ArrowDownRight, ArrowUpRight, RefreshCw, Sparkles } from 'lucide-react'
import type { SensitivityResult } from '../types/api'
import { dollars } from '../lib/preferences'

interface Props {
  result: SensitivityResult | null
  loading: boolean
  applying: boolean
  error: string | null
  selectedBudget: number | null
  onSelectBudget: (budget: number | null) => void
  onApplyBudget: (budget: number) => void
}

export function SensitivityPanel({ result, loading, applying, error, selectedBudget, onSelectBudget, onApplyBudget }: Props) {
  if (loading && !result) return <section className="surface p-5" aria-label="Budget sensitivity"><p role="status" className="flex items-center gap-2 text-sm text-muted"><RefreshCw size={15} className="animate-spin"/>Checking nearby budget thresholds…</p></section>
  if (error && !result) return <section className="surface p-5" aria-label="Budget sensitivity"><p role="alert" className="text-sm text-red-800">Sensitivity could not load: {error}</p></section>
  if (!result) return null
  const soft = !result.preferences.budget_is_hard_constraint
  const points = [
    { budget: result.preferences.monthly_budget, count: result.baseline.eligible_count, delta: 0, baseline: true, ids: [] as string[] },
    ...result.budget_variations.map(item => ({ budget: item.value, count: item.eligible_count, delta: item.eligible_count_change, baseline: false, ids: item.newly_eligible_area_ids })),
  ].sort((a,b) => a.budget - b.budget)
  const maxCount = Math.max(1, ...points.map(point => point.count))
  return <section className="surface p-5 md:p-6" aria-label="Budget sensitivity">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><span className="kicker">Budget sensitivity</span><h2 className="mt-1 font-display text-2xl text-ink md:text-3xl">What could a little flexibility unlock?</h2><p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">Each point reruns the same {result.preferences.bedrooms === 0 ? 'studio' : `${result.preferences.bedrooms}-bedroom`} search against the 64 Chicago areas. Counts are qualifying geographic areas, not apartment listings.</p></div><span className="rounded-full bg-mint px-3 py-1.5 text-xs font-bold text-forest">{result.baseline.eligible_count} areas now</span></div>
    {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">Updated sensitivity is unavailable: {error}</p>}
    {soft && <div className="mt-5 rounded-xl border border-line bg-canvas p-4 text-sm leading-relaxed text-muted">Your budget is soft. Changing it changes the budget comparison, but does not change which areas pass hard eligibility rules.</div>}
    <>
      <div aria-label="Exact budget sensitivity results" className="mt-6 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">{points.map(point => {
        const height = Math.max(10, Math.round(point.count / maxCount * 100))
        const selected = selectedBudget === point.budget
        return <button type="button" key={point.budget} aria-pressed={selected} aria-label={`${dollars(point.budget)} budget: ${point.count} qualifying areas${point.baseline ? ', current budget' : `, ${point.delta >= 0 ? 'up' : 'down'} ${Math.abs(point.delta)}`}${point.baseline ? ', currently applied' : ''}`} onClick={() => onSelectBudget(point.budget)} className={`flex min-h-36 w-full flex-col justify-between rounded-xl border p-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest ${point.baseline ? 'border-forest bg-[#edf5ef]' : 'border-line bg-white hover:border-forest'} ${selected ? 'ring-2 ring-forest ring-offset-2' : ''}`}>
          <div><div className="text-xs font-semibold text-muted">{point.baseline ? 'Current applied budget' : 'Scenario preview'}</div><div className="mt-1 text-base font-bold text-ink">{dollars(point.budget)}<span className="text-xs font-normal text-muted"> / month</span></div><div className="mt-1 text-sm font-semibold text-ink">{point.count} qualifying areas</div><div className="mt-1 text-xs text-muted">{point.baseline ? 'Applied now' : `${point.delta >= 0 ? '+' : '−'}${Math.abs(point.delta)} vs applied`}</div></div>
          <div className="mt-3 flex h-9 items-end gap-2"><div aria-hidden="true" className={`w-full rounded-t-md ${point.baseline ? 'bg-forest' : 'bg-[#80b6a2]'}`} style={{ height: `${height}%` }}/>{!point.baseline && <span className={`flex shrink-0 items-center text-xs font-bold ${point.delta >= 0 ? 'text-forest' : 'text-coral'}`}>{point.delta >= 0 ? <ArrowUpRight size={14}/> : <ArrowDownRight size={14}/>}{Math.abs(point.delta)}</span>}</div>
          {!point.baseline && point.ids.length > 0 && <span className="mt-1 text-[11px] leading-snug text-muted">New: {point.ids.map(id => id.slice(5)).join(', ')}</span>}
        </button>
      })}</div>
      <p className="mt-3 text-xs text-muted">Values are exact API reruns at these budgets. No values between thresholds are estimated.</p>
      {selectedBudget !== null && (() => {
        const point = points.find(item => item.budget === selectedBudget)
        if (!point) return null
        const changed = result.budget_variations.find(item => item.value === point.budget)
        return <div className="mt-4 rounded-xl border border-forest/30 bg-[#f5faf6] p-4" aria-live="polite" aria-label="Selected budget preview">
          <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-bold text-ink">Preview: {dollars(point.budget)} per month{point.baseline ? ' (current budget)' : ''}</h3><span className="text-sm font-semibold text-forest">{point.count} qualifying areas ({point.delta >= 0 ? '+' : '−'}{Math.abs(point.delta)} vs current {dollars(result.preferences.monthly_budget)})</span></div>
          {!!changed?.newly_eligible_area_ids.length && <p className="mt-2 text-sm text-muted">Newly qualifying: {changed.newly_eligible_area_ids.map(id => id.slice(5)).join(', ')}</p>}
          {!!changed?.no_longer_eligible_area_ids.length && <p className="mt-1 text-sm text-muted">No longer qualifying: {changed.no_longer_eligible_area_ids.map(id => id.slice(5)).join(', ')}</p>}
          {!changed?.newly_eligible_area_ids.length && !changed?.no_longer_eligible_area_ids.length && <p className="mt-2 text-sm text-muted">No areas change eligibility at this exact budget.</p>}
          <button type="button" disabled={applying || loading} onClick={() => onApplyBudget(point.budget)} className="mt-3 min-h-11 rounded-xl bg-forest px-4 py-2.5 text-sm font-bold text-white hover:bg-[#104a3f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest disabled:cursor-wait disabled:opacity-60">{applying ? 'Applying…' : 'Apply selected budget'}</button>
        </div>
      })()}
    </>
    <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-[#d7e4dc] bg-[#f5faf6] p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2 font-bold text-ink"><Sparkles size={17} className="text-forest"/>Next exact budget unlock</div><p className="mt-1 text-sm leading-relaxed text-muted">{result.next_budget_unlock_explanation}</p>{result.next_budget_unlock && <p className="mt-1 text-xs font-semibold text-forest">Newly qualifying ZIP: {result.next_budget_unlock.newly_unlocked_area_ids.map(id => id.slice(5)).join(', ')}</p>}</div>{result.next_budget_unlock && <button type="button" disabled={applying} onClick={() => onApplyBudget(result.next_budget_unlock!.monthly_budget)} className="min-h-11 shrink-0 rounded-xl bg-forest px-4 py-2.5 text-sm font-bold text-white hover:bg-[#104a3f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest disabled:cursor-wait disabled:opacity-60">{applying ? 'Applying…' : `Apply ${dollars(result.next_budget_unlock.monthly_budget)} budget`}</button>}</div>
    {loading && <p role="status" className="mt-3 text-xs text-muted">Refreshing after preference change…</p>}
  </section>
}
