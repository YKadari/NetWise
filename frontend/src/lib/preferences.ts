import { rentFields, type Bedroom, type Preferences } from '../types/api'

export type Preset = 'affordability' | 'balanced' | 'access'
export const presetWeights: Record<Preset, Pick<Preferences, 'rent_weight' | 'workplace_weight' | 'station_weight'>> = {
  affordability: { rent_weight: 0.6, workplace_weight: 0.2, station_weight: 0.2 },
  balanced: { rent_weight: 0.34, workplace_weight: 0.33, station_weight: 0.33 },
  access: { rent_weight: 0.1, workplace_weight: 0.45, station_weight: 0.45 },
}

export const bedroomLabels = ['Studio', '1 bed', '2 beds', '3 beds', '4 beds'] as const
export const rentFieldFor = (bedrooms: Bedroom) => rentFields[bedrooms]
export const dollars = (value: number | null | undefined) => value == null ? 'Not available' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
export const distance = (value: number | null | undefined) => value == null ? 'Not available' : `${value.toFixed(1)} km`

export interface FormValues {
  budget: string
  bedrooms: Bedroom
  income: string
  preset: Preset
  hardBudget: boolean
  maxLoop: string
  maxStation: string
}

export const defaultForm: FormValues = { budget: '1900', bedrooms: 1, income: '', preset: 'balanced', hardBudget: true, maxLoop: '', maxStation: '' }

export function validateForm(form: FormValues): string | null {
  const budget = Number(form.budget)
  if (!form.budget.trim() || !Number.isFinite(budget) || budget <= 0 || budget > 10_000_000) return 'Enter a monthly budget above $0.'
  if (form.income.trim() && (!Number.isFinite(Number(form.income)) || Number(form.income) <= 0)) return 'Annual income must be above $0.'
  for (const [value, label] of [[form.maxLoop, 'Loop distance'], [form.maxStation, 'Station distance']]) {
    if (value.trim() && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1000)) return `${label} must be between 0 and 1,000 km.`
  }
  return null
}

export function toPreferences(form: FormValues): Preferences {
  const error = validateForm(form)
  if (error) throw new Error(error)
  return {
    monthly_budget: Number(form.budget), bedrooms: form.bedrooms,
    ...(form.income.trim() ? { annual_income: Number(form.income) } : {}),
    budget_is_hard_constraint: form.hardBudget,
    ...(form.maxLoop.trim() ? { max_workplace_distance_km: Number(form.maxLoop) } : {}),
    ...(form.maxStation.trim() ? { max_station_distance_km: Number(form.maxStation) } : {}),
    ...presetWeights[form.preset], max_results: 10,
  }
}

export function toggleComparedAreas(current: string[], areaId: string): { ids: string[]; replacedAreaId: string | null } {
  if (current.includes(areaId)) return { ids: current.filter(id => id !== areaId), replacedAreaId: null }
  if (current.length < 2) return { ids: [...current, areaId], replacedAreaId: null }
  return { ids: [current[1], areaId], replacedAreaId: current[0] }
}
