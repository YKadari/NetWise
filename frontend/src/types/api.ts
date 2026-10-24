export type Bedroom = 0 | 1 | 2 | 3 | 4
export type RentField = 'hud_studio_rent' | 'hud_1br_rent' | 'hud_2br_rent' | 'hud_3br_rent' | 'hud_4br_rent'
export const rentFields: RentField[] = ['hud_studio_rent', 'hud_1br_rent', 'hud_2br_rent', 'hud_3br_rent', 'hud_4br_rent']

export interface Preferences {
  monthly_budget: number
  bedrooms: Bedroom
  annual_income?: number
  budget_is_hard_constraint: boolean
  max_workplace_distance_km?: number
  max_station_distance_km?: number
  rent_weight: number
  workplace_weight: number
  station_weight: number
  max_results: number
}

export interface Area {
  area_id: string
  zip_code: string
  latitude: number
  longitude: number
  hud_studio_rent: number | null
  hud_1br_rent: number | null
  hud_2br_rent: number | null
  hud_3br_rent: number | null
  hud_4br_rent: number | null
  workplace_name: string
  workplace_latitude: number
  workplace_longitude: number
  workplace_distance_km: number | null
  nearest_cta_station_name: string | null
  nearest_cta_station_km: number | null
  cta_stations_within_2km: number | null
  hud_data_year: number
  geography_source_year: number
  source_attribution: string
  distance_definition: string
  google_maps_directions_url?: string
  directions_note?: string
}

export interface Recommendation {
  area_id: string
  zip_code: string
  hud_monthly_rent: number
  budget_difference: number
  within_budget: boolean
  rent_burden_pct: number | null
  workplace_distance_km: number
  nearest_cta_station_name: string | null
  nearest_cta_station_km: number
  pareto_efficient: boolean
  normalized_preference_score: number
  explanation: string
}

export interface OptimizationResult {
  summary: {
    total_areas_evaluated: number
    eligible_count: number
    excluded_count: number
    pareto_efficient_count: number
  }
  recommendations: Recommendation[]
  diagnostics: {
    eligible_candidates: { area_id: string }[]
    pareto_frontier_area_ids: string[]
  }
}

export interface SensitivityVariation {
  value: number
  eligible_count: number
  excluded_count: number
  pareto_efficient_count: number
  eligible_count_change: number
  newly_eligible_area_ids: string[]
  no_longer_eligible_area_ids: string[]
}

export interface SensitivityResult {
  preferences: Preferences
  baseline: { eligible_count: number; excluded_count: number; pareto_efficient_count: number }
  budget_variations: SensitivityVariation[]
  workplace_limit_variations: SensitivityVariation[]
  station_limit_variations: SensitivityVariation[]
  next_budget_unlock: { monthly_budget: number; increase_required: number; newly_unlocked_area_ids: string[] } | null
  next_budget_unlock_explanation: string
  method: string
}

export interface AreaComparison extends Area {
  selected_bedrooms: Bedroom | null
  selected_hud_rent: number | null
  source_and_measurement_limitations: string[]
}

export interface AreaComparisonResult {
  area_ids: string[]
  bedrooms: Bedroom | null
  areas: AreaComparison[]
  pairwise_differences: {
    left_area_id: string
    right_area_id: string
    selected_hud_rent_difference_left_minus_right: number | null
    workplace_distance_km_difference_left_minus_right: number | null
    nearest_cta_station_km_difference_left_minus_right: number | null
  }[]
}

export interface FeatureCollection<P> {
  type: 'FeatureCollection'
  features: { type: 'Feature'; properties: P; geometry: { type: string; coordinates: unknown } }[]
}

export interface HousingProperties { area_id: string; zip_code: string }
export interface StationProperties { station_id: string; station_name: string; rail_routes: string }

