import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PreferencesPanel } from '../components/PreferencesPanel'
import { RecommendationsPanel } from '../components/RecommendationsPanel'
import { defaultForm } from '../lib/preferences'
import type { OptimizationResult } from '../types/api'

describe('explorer UI states', () => {
  it('changes bedrooms and applies only on submit', () => {
    const changed = vi.fn()
    const apply = vi.fn()
    render(<PreferencesPanel form={defaultForm} onChange={changed} onApply={apply} pending={false} dirty={false}/>)
    fireEvent.click(screen.getByRole('button', { name: '2 beds' }))
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ bedrooms: 2 }))
    expect(apply).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Explore areas' }))
    expect(apply).toHaveBeenCalledOnce()
  })
  it('renders a real empty result without invented cards', () => {
    const result: OptimizationResult = { summary: { total_areas_evaluated: 64, eligible_count: 0, excluded_count: 64, pareto_efficient_count: 0 }, recommendations: [], diagnostics: { eligible_candidates: [], pareto_frontier_area_ids: [] } }
    render(<RecommendationsPanel result={result} bedrooms={1} selectedId={null} comparedIds={[]} onSelect={vi.fn()} onCompare={vi.fn()} pending={false}/>)
    expect(screen.getByText('No areas match yet')).toBeInTheDocument()
    expect(screen.queryByText(/ZIP 606/)).not.toBeInTheDocument()
  })
  it('selects a recommendation and shows only backend-provided numbers', () => {
    const select = vi.fn()
    const result: OptimizationResult = { summary: { total_areas_evaluated: 64, eligible_count: 1, excluded_count: 63, pareto_efficient_count: 1 }, recommendations: [{ area_id: 'ZCTA:60653', zip_code: '60653', hud_monthly_rent: 1340, budget_difference: 560, within_budget: true, rent_burden_pct: null, workplace_distance_km: 7.532, nearest_cta_station_name: 'Example CTA', nearest_cta_station_km: 0.818, pareto_efficient: true, normalized_preference_score: 0.2, explanation: 'Backend explanation.' }], diagnostics: { eligible_candidates: [{ area_id: 'ZCTA:60653' }], pareto_frontier_area_ids: ['ZCTA:60653'] } }
    render(<RecommendationsPanel result={result} bedrooms={1} selectedId="ZCTA:60653" comparedIds={[]} onSelect={select} onCompare={vi.fn()} pending={false}/>)
    expect(screen.getByText('$1,340')).toBeInTheDocument()
    expect(screen.getByText('Backend explanation.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /ZIP 60653/ }))
    expect(select).toHaveBeenCalledWith('ZCTA:60653')
  })
})
