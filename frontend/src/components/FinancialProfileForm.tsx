import type { ProfileDraft } from '../lib/rentalForms'

interface Props { enabled: boolean; value: ProfileDraft; onEnabled: (enabled: boolean) => void; onChange: (value: ProfileDraft) => void }

export function FinancialProfileForm({ enabled, value, onEnabled, onChange }: Props) {
  const update = (patch: Partial<ProfileDraft>) => onChange({ ...value, ...patch })
  const field = (label: string, key: keyof Pick<ProfileDraft, 'income' | 'savings' | 'essentials' | 'loan' | 'target' | 'roommate' | 'reserve'>, required = false) => <label className="label">{label}{!required && <span className="ml-1 font-normal text-muted">(optional)</span>}<input className="field mt-1" type="number" min="0" step="0.01" inputMode="decimal" value={value[key]} onChange={event => update({ [key]: event.target.value })}/></label>
  return <section className="surface p-5" aria-label="Financial profile"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="kicker">Your financial context</div><h2 className="mt-1 font-display text-2xl">Make the cash flow personal</h2><p className="mt-2 max-w-2xl text-sm text-muted">Use your own take-home pay and expense assumptions. This is not a salary or tax estimate.</p></div><label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" className="accent-forest" checked={enabled} onChange={event => onEnabled(event.target.checked)}/>Include my finances</label></div>
    {enabled && <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {field('Monthly take-home income', 'income', true)}{field('Available savings', 'savings', true)}{field('Essential nonhousing expenses / month', 'essentials', true)}
      <label className="flex items-start gap-2 self-end rounded-xl border border-line bg-canvas p-3 text-sm text-ink"><input className="mt-1 accent-forest" type="checkbox" checked={value.loanIncluded} onChange={event => update({ loanIncluded: event.target.checked })}/><span>Student loan payment is already included in essential expenses.</span></label>
      {!value.loanIncluded && field('Separate student loan payment / month', 'loan')}
      {field('Monthly savings target', 'target')}{field('Expected roommate contribution / month', 'roommate')}{field('Minimum emergency cash reserve', 'reserve')}
      <p className="self-end text-xs leading-relaxed text-muted sm:col-span-2">A separate loan payment is subtracted only when it is not already in essential expenses. A profile roommate amount overrides the offer estimate for your modeled share.</p>
    </div>}
  </section>
}
