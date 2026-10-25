import { BarChart3, Compass, FileText } from 'lucide-react'

export type ProductView = 'explore' | 'analyze' | 'compare'
const items: { id: ProductView; label: string; detail: string; Icon: typeof Compass }[] = [
  { id: 'explore', label: 'Explore', detail: 'Chicago areas', Icon: Compass },
  { id: 'analyze', label: 'Analyze', detail: 'Rental terms', Icon: FileText },
  { id: 'compare', label: 'Compare', detail: 'Two rentals', Icon: BarChart3 },
]
export function ProductNavigation({ view, onChange }: { view: ProductView; onChange: (view: ProductView) => void }) {
  return <nav aria-label="Primary navigation" className="border-b border-line bg-white px-4 py-2 md:px-8"><div className="mx-auto grid max-w-[1700px] grid-cols-3 gap-2 md:flex md:gap-3">{items.map(({ id, label, detail, Icon }) => <button key={id} type="button" aria-current={view === id ? 'page' : undefined} onClick={() => onChange(id)} className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest md:justify-start md:px-5 ${view === id ? 'bg-forest text-white' : 'text-muted hover:bg-canvas hover:text-ink'}`}><Icon size={17}/><span>{label}<span className={`hidden text-xs font-normal md:ml-2 md:inline ${view === id ? 'text-white/75' : 'text-muted'}`}>{detail}</span></span></button>)}</div></nav>
}
