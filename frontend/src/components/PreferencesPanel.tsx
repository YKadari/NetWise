import { SlidersHorizontal, RotateCcw } from 'lucide-react'
import { bedroomLabels, validateForm, type FormValues, type Preset } from '../lib/preferences'
import type { Bedroom } from '../types/api'

const presets: { id: Preset; label: string; subtitle: string }[] = [
  { id: 'affordability', label: 'Save more', subtitle: 'Rent first' },
  { id: 'balanced', label: 'Balanced', subtitle: 'An even view' },
  { id: 'access', label: 'Stay close', subtitle: 'Loop + rail' },
]

interface Props { form: FormValues; onChange: (form: FormValues) => void; onApply: () => void; pending: boolean; dirty: boolean }
export function PreferencesPanel({ form, onChange, onApply, pending, dirty }: Props) {
  const update = (patch: Partial<FormValues>) => onChange({ ...form, ...patch })
  const error = validateForm(form)
  return <aside className="panel flex flex-col gap-6 p-5 lg:p-6" aria-label="Housing preferences">
    <div><div className="flex items-center gap-2 text-forest"><SlidersHorizontal size={18}/><span className="eyebrow">Your search</span></div><h2 className="mt-2 font-display text-2xl text-ink">What matters to you?</h2><p className="mt-2 text-sm leading-relaxed text-muted">Find areas that fit your budget and the way you move around Chicago.</p></div>
    <form onSubmit={event => { event.preventDefault(); if (!error) onApply() }} className="space-y-6">
      <div><label htmlFor="budget" className="label">Monthly rent budget</label><div className="relative mt-2"><span className="absolute left-3 top-2.5 text-muted">$</span><input id="budget" type="number" min="1" max="10000000" step="1" inputMode="decimal" className="field pl-8 text-lg font-semibold" value={form.budget} onChange={event => update({ budget: event.target.value })} /></div><p className="hint">HUD benchmark, dollars per month</p></div>
      <fieldset><legend className="label">Bedrooms</legend><div className="mt-2 grid grid-cols-5 gap-1 rounded-xl bg-canvas p-1">{bedroomLabels.map((label, index) => <button type="button" aria-pressed={form.bedrooms === index} aria-label={label} key={label} onClick={() => update({ bedrooms: index as Bedroom })} className={`rounded-lg px-1 py-2 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest ${form.bedrooms === index ? 'bg-white text-forest shadow-sm' : 'text-muted hover:text-ink'}`}>{index === 0 ? 'Studio' : index}</button>)}</div></fieldset>
      <div><label htmlFor="income" className="label">Annual income <span className="font-normal text-muted">(optional)</span></label><div className="relative mt-2"><span className="absolute left-3 top-2.5 text-muted">$</span><input id="income" type="number" min="1" inputMode="decimal" className="field pl-8" placeholder="For rent burden context" value={form.income} onChange={event => update({ income: event.target.value })} /></div></div>
      <fieldset><legend className="label">Your priority</legend><p className="hint mb-2">Changes how eligible areas are ordered.</p><div className="grid grid-cols-3 gap-2">{presets.map(preset => <button type="button" key={preset.id} aria-pressed={form.preset === preset.id} onClick={() => update({ preset: preset.id })} className={`rounded-xl border px-2 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest ${form.preset === preset.id ? 'border-forest bg-mint text-forest' : 'border-line bg-white text-ink hover:border-forest'}`}><span className="block text-xs font-bold">{preset.label}</span><span className="mt-0.5 block text-[11px] opacity-75">{preset.subtitle}</span></button>)}</div></fieldset>
      <details className="rounded-xl border border-line bg-canvas p-3"><summary className="cursor-pointer text-sm font-semibold text-ink">More filters</summary><div className="mt-4 space-y-4"><label className="flex items-start gap-2 text-sm text-ink"><input type="checkbox" className="mt-1 accent-forest" checked={form.hardBudget} onChange={event => update({ hardBudget: event.target.checked })}/><span>Stay within budget<span className="block text-xs text-muted">Turn off to see areas above your budget.</span></span></label><div><label htmlFor="max-loop" className="label">Maximum Loop distance (km)</label><input id="max-loop" type="number" min="0" max="1000" step="any" className="field mt-2" placeholder="No maximum" value={form.maxLoop} onChange={event => update({ maxLoop: event.target.value })}/></div><div><label htmlFor="max-station" className="label">Maximum rail station distance (km)</label><input id="max-station" type="number" min="0" max="1000" step="any" className="field mt-2" placeholder="No maximum" value={form.maxStation} onChange={event => update({ maxStation: event.target.value })}/></div></div></details>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button type="submit" disabled={Boolean(error) || pending} className="flex w-full items-center justify-center gap-2 rounded-xl bg-forest px-4 py-3.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#104a3f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest disabled:cursor-not-allowed disabled:opacity-50">{pending ? <RotateCcw size={16} className="animate-spin"/> : null}{pending ? 'Finding areas…' : dirty ? 'Update my results' : 'Explore areas'}</button>
      {dirty && !pending && !error && <p className="text-center text-xs text-muted">Apply changes to refresh the map and recommendations.</p>}
    </form>
  </aside>
}
