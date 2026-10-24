import type { Area, AreaComparisonResult, FeatureCollection, HousingProperties, OptimizationResult, Preferences, SensitivityResult, StationProperties } from '../types/api'

export class ApiError extends Error {
  constructor(message: string, public status?: number) { super(message) }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response
  try { response = await fetch(`/api${path}`, options) }
  catch { throw new ApiError('Cannot connect to NestWise. Start the FastAPI server and try again.') }
  if (!response.ok) {
    let detail = ''
    try {
      const body = await response.json()
      detail = typeof body.detail === 'string' ? body.detail : ''
    } catch { /* A proxy or server may return plain text. */ }
    throw new ApiError(detail || (response.status === 422 ? 'Check your preferences and try again.' : `Request failed (${response.status}).`), response.status)
  }
  try { return await response.json() as T }
  catch { throw new ApiError('The server returned an unreadable response.') }
}

function isArea(value: unknown): value is Area {
  if (!value || typeof value !== 'object') return false
  const area = value as Record<string, unknown>
  return typeof area.area_id === 'string' && typeof area.zip_code === 'string' && typeof area.latitude === 'number' && typeof area.longitude === 'number'
}

export async function getAreas(signal?: AbortSignal): Promise<Area[]> {
  const data = await request<{ total: number; areas: unknown[] }>('/areas?limit=100', { signal })
  if (!Array.isArray(data.areas) || data.total !== data.areas.length || !data.areas.every(isArea)) throw new ApiError('Area data is incomplete.')
  return data.areas
}

export async function getArea(areaId: string, signal?: AbortSignal): Promise<Area> {
  const area = await request<unknown>(`/areas/${encodeURIComponent(areaId)}`, { signal })
  if (!isArea(area)) throw new ApiError('Area details are incomplete.')
  return area
}

export async function getHousing(signal?: AbortSignal): Promise<FeatureCollection<HousingProperties>> {
  const data = await request<FeatureCollection<HousingProperties>>('/geo/housing', { signal })
  if (data.type !== 'FeatureCollection' || !Array.isArray(data.features) || data.features.some(f => !f.properties?.area_id || !f.geometry)) throw new ApiError('Map boundaries are unavailable.')
  return data
}

export async function getStations(signal?: AbortSignal): Promise<FeatureCollection<StationProperties>> {
  const data = await request<FeatureCollection<StationProperties>>('/geo/stations', { signal })
  if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new ApiError('Station locations are unavailable.')
  return data
}

export async function optimize(preferences: Preferences, signal?: AbortSignal): Promise<OptimizationResult> {
  const data = await request<OptimizationResult>('/optimize', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(preferences), signal,
  })
  if (!data.summary || !Array.isArray(data.recommendations) || !Array.isArray(data.diagnostics?.eligible_candidates)) throw new ApiError('Optimization response is incomplete.')
  return data
}

export async function analyzeSensitivity(preferences: Preferences, signal?: AbortSignal): Promise<SensitivityResult> {
  const data = await request<SensitivityResult>('/sensitivity', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preferences }), signal,
  })
  if (!data.baseline || !Array.isArray(data.budget_variations) || !data.next_budget_unlock_explanation) throw new ApiError('Sensitivity response is incomplete.')
  return data
}

export async function compareAreas(areaIds: string[], bedrooms: number, signal?: AbortSignal): Promise<AreaComparisonResult> {
  if (areaIds.length !== 2 || new Set(areaIds).size !== 2 || areaIds.some(id => !/^ZCTA:\d{5}$/.test(id))) throw new ApiError('Choose two different Chicago areas to compare.')
  if (!Number.isInteger(bedrooms) || bedrooms < 0 || bedrooms > 4) throw new ApiError('Choose a valid bedroom count to compare.')
  const data = await request<AreaComparisonResult>('/areas/compare', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ area_ids: areaIds, bedrooms }), signal,
  })
  if (!Array.isArray(data.areas) || data.areas.length !== 2 || !Array.isArray(data.pairwise_differences)) throw new ApiError('Area comparison response is incomplete.')
  return data
}
