import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAreas, optimize } from '../lib/api'
import { defaultForm, toPreferences } from '../lib/preferences'

afterEach(() => vi.unstubAllGlobals())

describe('API contract', () => {
  it('posts preferences to the relative FastAPI proxy path', async () => {
    const result = { summary: { eligible_count: 0 }, recommendations: [], diagnostics: { eligible_candidates: [] } }
    const mocked = vi.fn().mockResolvedValue({ ok: true, json: async () => result })
    vi.stubGlobal('fetch', mocked)
    expect(await optimize(toPreferences(defaultForm))).toEqual(result)
    const [path, options] = mocked.mock.calls[0]
    expect(path).toBe('/api/optimize')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toMatchObject({ monthly_budget: 1900, bedrooms: 1 })
  })
  it('rejects incomplete public area lists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ total: 64, areas: [] }) }))
    await expect(getAreas()).rejects.toThrow('incomplete')
  })
  it('provides a useful connection error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(optimize(toPreferences(defaultForm))).rejects.toThrow('Cannot connect')
  })
})
