import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PUBLIC_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
]

const PLACEHOLDER = /^(?:your[-_]|<|placeholder\b|changeme\b|replace[-_ ]?me\b|example(?:\.|$))/i

function validAuthDomain(value) {
  if (!value || /[\s/@?#]/.test(value) || value.includes('://')) return false
  try {
    const parsed = new URL(`https://${value}`)
    return parsed.hostname.includes('.') && parsed.host.toLowerCase() === value.toLowerCase() && parsed.pathname === '/'
  } catch {
    return false
  }
}

/** Return invalid configuration variable names only; never include supplied values. */
export function getFirebaseConfigProblems(env, { required = true } = {}) {
  if (!required) return []

  const problems = new Set()
  const config = Object.fromEntries(PUBLIC_KEYS.map(key => [key, typeof env[key] === 'string' ? env[key].trim() : '']))

  for (const key of PUBLIC_KEYS) {
    const value = config[key]
    if (!value || PLACEHOLDER.test(value)) problems.add(key)
  }

  if (config.VITE_FIREBASE_API_KEY && !/^AIza[0-9A-Za-z_-]{30,}$/.test(config.VITE_FIREBASE_API_KEY)) {
    problems.add('VITE_FIREBASE_API_KEY')
  }
  if (config.VITE_FIREBASE_AUTH_DOMAIN && !validAuthDomain(config.VITE_FIREBASE_AUTH_DOMAIN)) {
    problems.add('VITE_FIREBASE_AUTH_DOMAIN')
  }
  if (config.VITE_FIREBASE_PROJECT_ID && !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(config.VITE_FIREBASE_PROJECT_ID)) {
    problems.add('VITE_FIREBASE_PROJECT_ID')
  }
  if (config.VITE_FIREBASE_APP_ID && !/^\d+:\d+:web:[A-Za-z0-9_-]+$/.test(config.VITE_FIREBASE_APP_ID)) {
    problems.add('VITE_FIREBASE_APP_ID')
  }

  const backendProjectId = typeof env.FIREBASE_PROJECT_ID === 'string' ? env.FIREBASE_PROJECT_ID.trim() : ''
  if (backendProjectId && config.VITE_FIREBASE_PROJECT_ID && backendProjectId !== config.VITE_FIREBASE_PROJECT_ID) {
    problems.add('VITE_FIREBASE_PROJECT_ID')
  }
  return PUBLIC_KEYS.filter(key => problems.has(key))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const required = !['0', 'false', 'no', 'off'].includes(
    String(process.env.NESTWISE_REQUIRE_FIREBASE_CONFIG ?? 'true').trim().toLowerCase(),
  )
  const problems = getFirebaseConfigProblems(process.env, { required })
  if (problems.length > 0) {
    console.error(`Firebase web configuration is missing or invalid for this production build: ${problems.join(', ')}. Set the values in the build environment; values are not displayed.`)
    process.exitCode = 1
  }
}

