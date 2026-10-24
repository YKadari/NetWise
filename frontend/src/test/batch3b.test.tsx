import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { analyzeSensitivity, compareAreas, ApiError } from '../lib/api'
import { defaultForm, toPreferences, toggleComparedAreas } from '../lib/preferences'
import { SensitivityPanel } from '../components/SensitivityPanel'
import { ComparisonDialog } from '../components/ComparisonDialog'
import type { OptimizationResult, SensitivityResult } from '../types/api'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const response: SensitivityResult = {
  preferences: toPreferences({ ...defaultForm, budget: '1600' }),
  baseline: { eligible_count: 24, excluded_count: 40, pareto_efficient_count: 8 },
  budget_variations: [
    { value: 1400, eligible_count: 8, excluded_count: 56, pareto_efficient_count: 4, eligible_count_change: -16, newly_eligible_area_ids: [], no_longer_eligible_area_ids: ['ZCTA:60608'] },
    { value: 1500, eligible_count: 16, excluded_count: 48, pareto_efficient_count: 6, eligible_count_change: -8, newly_eligible_area_ids: [], no_longer_eligible_area_ids: [] },
    { value: 1700, eligible_count: 30, excluded_count: 34, pareto_efficient_count: 9, eligible_count_change: 6, newly_eligible_area_ids: ['ZCTA:60638'], no_longer_eligible_area_ids: [] },
  ],
  workplace_limit_variations: [], station_limit_variations: [],
  next_budget_unlock: { monthly_budget: 1620, increase_required: 20, newly_unlocked_area_ids: ['ZCTA:60638'] },
  next_budget_unlock_explanation: 'Increase the monthly budget by $20 to $1,620 to unlock the next area.',
  method: 'Exact reruns on the same public area snapshot.',
}

const optimizer: OptimizationResult = {
  summary: { total_areas_evaluated: 64, eligible_count: 24, excluded_count: 40, pareto_efficient_count: 8 },
  recommendations: [], diagnostics: { eligible_candidates: [], pareto_frontier_area_ids: ['ZCTA:60601'] },
}

describe('sensitivity API and panel', () => {
  function InteractivePanel({ apply = vi.fn() }: { apply?: (budget: number) => void }) {
    const [selected, setSelected] = useState<number | null>(null)
    return <SensitivityPanel result={response} loading={false} applying={false} error={null} selectedBudget={selected} onSelectBudget={setSelected} onApplyBudget={apply}/>
  }
  it('posts the current profile so changed hard limits and bedroom count are preserved', async () => {
    const mocked = vi.fn().mockResolvedValue({ ok: true, json: async () => response })
    vi.stubGlobal('fetch', mocked)
    const profile = { ...toPreferences(defaultForm), bedrooms: 3 as const, max_station_distance_km: 2 }
    await analyzeSensitivity(profile)
    expect(mocked).toHaveBeenCalledWith('/api/sensitivity', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(mocked.mock.calls[0][1].body)).toEqual({ preferences: profile })
  })
  it('shows the exact next threshold and applies the suggested budget', () => {
    const apply = vi.fn()
    render(<SensitivityPanel result={response} loading={false} applying={false} error={null} selectedBudget={null} onSelectBudget={vi.fn()} onApplyBudget={apply}/>)
    expect(screen.getByText('24 areas now')).toBeInTheDocument()
    expect(screen.getByText(/Newly qualifying ZIP: 60638/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Apply $1,620 budget' }))
    expect(apply).toHaveBeenCalledWith(1620)
    expect(screen.getByLabelText('$1,700 budget: 30 qualifying areas, up 6')).toBeInTheDocument()
  })
  it('supports keyboard focus, previews API eligibility changes, and applies only on explicit action', () => {
    const apply = vi.fn()
    render(<InteractivePanel apply={apply}/> )
    const scenario = screen.getByRole('button', { name: '$1,700 budget: 30 qualifying areas, up 6' })
    expect(scenario).toHaveAttribute('aria-pressed', 'false')
    scenario.focus()
    expect(document.activeElement).toBe(scenario)
    fireEvent.click(scenario)
    expect(scenario).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Selected budget preview')).toHaveTextContent('$1,700')
    expect(screen.getByLabelText('Selected budget preview')).toHaveTextContent('30 qualifying areas (+6 vs current $1,600)')
    expect(screen.getByText('Newly qualifying: 60638')).toBeInTheDocument()
    expect(apply).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Apply selected budget' }))
    expect(apply).toHaveBeenCalledWith(1700)
  })
  it('previews areas that no longer qualify at a lower budget', () => {
    render(<InteractivePanel/> )
    fireEvent.click(screen.getByRole('button', { name: '$1,400 budget: 8 qualifying areas, down 16' }))
    expect(screen.getByText('No longer qualifying: 60608')).toBeInTheDocument()
  })
  it('shows the current applied budget distinctly and clears preview when result is unavailable', () => {
    const view = render(<SensitivityPanel result={response} loading={false} applying={false} error={null} selectedBudget={1700} onSelectBudget={vi.fn()} onApplyBudget={vi.fn()}/> )
    expect(screen.getByText('Current applied budget')).toBeInTheDocument()
    expect(screen.getByText('Next exact budget unlock')).toBeInTheDocument()
    view.rerender(<SensitivityPanel result={null} loading={true} applying={false} error={null} selectedBudget={1700} onSelectBudget={vi.fn()} onApplyBudget={vi.fn()}/> )
    expect(screen.queryByLabelText('Selected budget preview')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Checking nearby budget thresholds')
  })
  it('keeps nearby counts flat and hides unlock action for a soft budget', () => {
    const soft: SensitivityResult = { ...response, preferences: { ...response.preferences, budget_is_hard_constraint: false }, next_budget_unlock: null, next_budget_unlock_explanation: 'The budget is soft, so changing it does not change rent-based eligibility.', budget_variations: response.budget_variations.map(item => ({ ...item, eligible_count: 24, eligible_count_change: 0 })) }
    render(<SensitivityPanel result={soft} loading={false} applying={false} error={null} selectedBudget={null} onSelectBudget={vi.fn()} onApplyBudget={vi.fn()}/>)
    expect(screen.getByText(/Your budget is soft/)).toBeInTheDocument()
    expect(screen.getByLabelText('$1,700 budget: 24 qualifying areas, up 0')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Apply.*budget/ })).not.toBeInTheDocument()
  })
  it('handles no further unlocks, empty counts, loading, and API errors', () => {
    const empty = { ...response, baseline: { eligible_count: 0, excluded_count: 64, pareto_efficient_count: 0 }, next_budget_unlock: null, next_budget_unlock_explanation: 'No higher HUD rent can unlock another area.' }
    const view = render(<SensitivityPanel result={empty} loading={false} applying={false} error={null} selectedBudget={null} onSelectBudget={vi.fn()} onApplyBudget={vi.fn()}/>)
    expect(screen.getByText('0 areas now')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Apply.*budget/ })).not.toBeInTheDocument()
    view.rerender(<SensitivityPanel result={null} loading={true} applying={false} error={null} selectedBudget={null} onSelectBudget={vi.fn()} onApplyBudget={vi.fn()}/>)
    expect(screen.getByRole('status')).toHaveTextContent(/Checking nearby budget thresholds/)
    view.rerender(<SensitivityPanel result={null} loading={false} applying={false} error="offline" selectedBudget={null} onSelectBudget={vi.fn()} onApplyBudget={vi.fn()}/>)
    expect(screen.getByRole('alert')).toHaveTextContent('offline')
  })
})

describe('area comparison', () => {
  it('adds, removes, and replaces areas while preserving exactly two selections', () => {
    const first = toggleComparedAreas([], 'ZCTA:60601')
    const second = toggleComparedAreas(first.ids, 'ZCTA:60608')
    expect(second.ids).toEqual(['ZCTA:60601','ZCTA:60608'])
    expect(toggleComparedAreas(second.ids, 'ZCTA:60601').ids).toEqual(['ZCTA:60608'])
    expect(toggleComparedAreas(second.ids, 'ZCTA:60609')).toEqual({ ids: ['ZCTA:60608','ZCTA:60609'], replacedAreaId: 'ZCTA:60601' })
  })
  it('rejects invalid comparison sizes and duplicate IDs before requesting', async () => {
    const mocked = vi.fn()
    vi.stubGlobal('fetch', mocked)
    await expect(compareAreas(['ZCTA:60601'], 1)).rejects.toThrow(ApiError)
    await expect(compareAreas(['ZCTA:60601','ZCTA:60601'], 1)).rejects.toThrow(/two different/)
    expect(mocked).not.toHaveBeenCalled()
  })
  it('sends the selected two areas and bedroom to the API', async () => {
    const payload = { areas: [{ area_id: 'ZCTA:60601' }, { area_id: 'ZCTA:60608' }], pairwise_differences: [] }
    const mocked = vi.fn().mockResolvedValue({ ok: true, json: async () => payload })
    vi.stubGlobal('fetch', mocked)
    await compareAreas(['ZCTA:60601','ZCTA:60608'], 1)
    expect(JSON.parse(mocked.mock.calls[0][1].body)).toEqual({ area_ids: ['ZCTA:60601','ZCTA:60608'], bedrooms: 1 })
  })
  it('renders real comparison fields and factual differences', async () => {
    const left = { area_id:'ZCTA:60601', zip_code:'60601', latitude:41.88, longitude:-87.62, hud_studio_rent:2520, hud_1br_rent:2670, hud_2br_rent:3020, hud_3br_rent:3880, hud_4br_rent:4440, selected_bedrooms:1, selected_hud_rent:2670, workplace_name:'Loop', workplace_latitude:41.88, workplace_longitude:-87.63, workplace_distance_km:0.6215, nearest_cta_station_name:'Washington/Wabash', nearest_cta_station_km:0.2857, cta_stations_within_2km:22, hud_data_year:2027, geography_source_year:2020, source_attribution:'HUD; Census; CTA', distance_definition:'Straight-line', source_and_measurement_limitations:[], google_maps_directions_url:'https://www.google.com/maps/dir/?api=1' }
    const right = { ...left, area_id:'ZCTA:60608', zip_code:'60608', hud_studio_rent:1440, hud_1br_rent:1530, hud_2br_rent:1730, hud_3br_rent:2220, hud_4br_rent:2540, selected_hud_rent:1530, workplace_distance_km:5.1531, nearest_cta_station_name:'Damen (Pink)', nearest_cta_station_km:0.7002, cta_stations_within_2km:5 }
    const payload = { area_ids:['ZCTA:60601','ZCTA:60608'], bedrooms:1, areas:[left,right], pairwise_differences:[{ left_area_id:'ZCTA:60601', right_area_id:'ZCTA:60608', selected_hud_rent_difference_left_minus_right:1140, workplace_distance_km_difference_left_minus_right:-4.5316, nearest_cta_station_km_difference_left_minus_right:-0.4145 }] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok:true, json:async()=>payload }))
    render(<ComparisonDialog ids={payload.area_ids} bedrooms={1} budget={1900} optimization={optimizer} onClose={vi.fn()}/>)
    expect(await screen.findAllByText('$2,670')).toHaveLength(2)
    expect(screen.getByText('Washington/Wabash · 0.3 km')).toBeInTheDocument()
    const facts = screen.getByLabelText('Measured differences').textContent || ''
    expect(facts).toContain('ZIP 60608 costs $1,140 less')
    expect(facts).toContain('ZIP 60601 is 4.5 km closer to the Loop')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
