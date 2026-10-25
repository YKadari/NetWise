import { Compass, Info, MapPin } from 'lucide-react'

export function Header() {
  return <header className="border-b border-line bg-white/90 px-5 py-4 md:px-8">
    <div className="mx-auto flex max-w-[1700px] flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-forest text-white"><Compass size={23} /></span><div><div className="text-xl font-bold tracking-tight text-ink">NestWise<span className="text-forest">.</span></div><div className="text-sm text-muted">Find your place. Know what you're signing.</div></div></div>
      <div className="flex items-center gap-3"><span className="inline-flex items-center gap-1.5 rounded-full bg-canvas px-3 py-2 text-sm font-semibold text-ink"><MapPin size={15} /> Chicago pilot</span><details className="relative z-[1000]"><summary aria-label="About the data and this pilot" className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-full border border-line bg-white text-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest"><Info size={18} /></summary><div className="absolute right-0 top-12 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-line bg-white p-5 text-sm leading-relaxed text-muted shadow-xl"><strong className="block text-base text-ink">A Chicago housing pilot</strong><p className="mt-2">This explorer compares 64 Census ZCTAs, not apartment listings. HUD rent benchmarks are federal payment standards and do not show what homes are available.</p><p className="mt-2">Loop and rail distances are straight-line measurements from each area's representative point, not route distances or commute times. The demo assumes a Chicago Loop destination.</p><p className="mt-2 text-xs">Sources: HUD FY2027, Census 2020 ZCTA, and CTA rail data.</p></div></details></div>
    </div>
  </header>
}
