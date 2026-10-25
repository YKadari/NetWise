import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getFirebaseConfigProblems } from './validate-firebase-config.mjs'

const validConfig = {
  VITE_FIREBASE_API_KEY: `AIza${'A'.repeat(35)}`,
  VITE_FIREBASE_AUTH_DOMAIN: 'nestwise-94e71.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'nestwise-94e71',
  VITE_FIREBASE_APP_ID: '1:123456789:web:abcdef012345',
  FIREBASE_PROJECT_ID: 'nestwise-94e71',
}

describe('production Firebase build configuration validation', () => {
  it('rejects missing required Firebase variables by name only', () => {
    const problems = getFirebaseConfigProblems({})
    expect(problems).toEqual([
      'VITE_FIREBASE_API_KEY',
      'VITE_FIREBASE_AUTH_DOMAIN',
      'VITE_FIREBASE_PROJECT_ID',
      'VITE_FIREBASE_APP_ID',
    ])
  })

  it('accepts complete Firebase web configuration for the matching backend project', () => {
    expect(getFirebaseConfigProblems(validConfig)).toEqual([])
  })

  it('rejects malformed and placeholder values without returning their contents', () => {
    const supplied = {
      ...validConfig,
      VITE_FIREBASE_API_KEY: 'private-looking-malformed-value',
      VITE_FIREBASE_AUTH_DOMAIN: 'https://not-a-host/path',
      VITE_FIREBASE_PROJECT_ID: 'your-firebase-project-id',
      VITE_FIREBASE_APP_ID: 'not-a-firebase-app-id',
    }
    const problems = getFirebaseConfigProblems(supplied)
    expect(problems).toEqual([
      'VITE_FIREBASE_API_KEY',
      'VITE_FIREBASE_AUTH_DOMAIN',
      'VITE_FIREBASE_PROJECT_ID',
      'VITE_FIREBASE_APP_ID',
    ])
    expect(JSON.stringify(problems)).not.toContain(supplied.VITE_FIREBASE_API_KEY)
  })

  it('rejects a frontend/backend Firebase project mismatch', () => {
    expect(getFirebaseConfigProblems({ ...validConfig, FIREBASE_PROJECT_ID: 'another-project' }))
      .toContain('VITE_FIREBASE_PROJECT_ID')
  })

  it('can skip validation only when Firebase authentication is explicitly not expected', () => {
    expect(getFirebaseConfigProblems({}, { required: false })).toEqual([])
  })

  it('fails the production build check with variable names but never echoes supplied values', () => {
    const marker = 'synthetic-invalid-public-value-must-not-be-printed'
    const result = spawnSync(process.execPath, [resolve(process.cwd(), 'scripts/validate-firebase-config.mjs')], {
      env: { PATH: process.env.PATH, NESTWISE_REQUIRE_FIREBASE_CONFIG: 'true', VITE_FIREBASE_API_KEY: marker },
      encoding: 'utf8',
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('VITE_FIREBASE_API_KEY')
    expect(result.stderr).not.toContain(marker)
  })
})
