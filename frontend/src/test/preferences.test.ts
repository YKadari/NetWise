import { describe, expect, it } from 'vitest'
import { bedroomLabels, defaultForm, dollars, presetWeights, rentFieldFor, toPreferences, validateForm } from '../lib/preferences'

describe('preference controls', () => {
  it('uses exact default backend values', () => {
    expect(toPreferences(defaultForm)).toEqual({ monthly_budget: 1900, bedrooms: 1, budget_is_hard_constraint: true, ...presetWeights.balanced, max_results: 10 })
  })
  it('maps each preset to nonnegative weights summing to one', () => {
    for (const weights of Object.values(presetWeights)) expect(Object.values(weights).reduce((a, b) => a + b, 0)).toBeCloseTo(1)
    expect(presetWeights.affordability.rent_weight).toBeGreaterThan(presetWeights.access.rent_weight)
  })
  it('maps every bedroom to its HUD benchmark', () => {
    expect(bedroomLabels).toHaveLength(5)
    expect([0,1,2,3,4].map(i => rentFieldFor(i as 0|1|2|3|4))).toEqual(['hud_studio_rent','hud_1br_rent','hud_2br_rent','hud_3br_rent','hud_4br_rent'])
  })
  it('formats real USD values and distinguishes missing values', () => {
    expect(dollars(1340)).toBe('$1,340')
    expect(dollars(null)).toBe('Not available')
  })
  it('rejects invalid budgets, income, and distances', () => {
    expect(validateForm({ ...defaultForm, budget: '' })).toBeTruthy()
    expect(validateForm({ ...defaultForm, budget: '-1' })).toBeTruthy()
    expect(validateForm({ ...defaultForm, income: '0' })).toBeTruthy()
    expect(validateForm({ ...defaultForm, maxLoop: '-2' })).toBeTruthy()
    expect(validateForm({ ...defaultForm, maxStation: '1001' })).toBeTruthy()
  })
  it('includes only optional values actually entered', () => {
    expect(toPreferences({ ...defaultForm, income: '75000', maxLoop: '8', maxStation: '2' })).toMatchObject({ annual_income: 75000, max_workplace_distance_km: 8, max_station_distance_km: 2 })
  })
})
