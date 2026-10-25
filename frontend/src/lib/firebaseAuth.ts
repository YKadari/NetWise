import { getApps, initializeApp } from 'firebase/app'
import {
  browserPopupRedirectResolver,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  inMemoryPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth'

export interface FirebaseClientConfig {
  apiKey: string
  authDomain: string
  projectId: string
  appId: string
}

const clientConfig: FirebaseClientConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
}

export function firebaseClientConfigured(): boolean {
  return Object.values(clientConfig).every(value => value.length > 0)
}

export function firebaseProjectId(): string { return clientConfig.projectId }

export function firebaseAuth(): Auth {
  if (!firebaseClientConfigured()) throw new Error('firebase_not_configured')
  const app = getApps().find(candidate => candidate.name === 'nestwise') ?? initializeApp(clientConfig, 'nestwise')
  return getAuth(app)
}

export function watchFirebaseUser(onUser: (user: User | null) => void, onError: () => void): () => void {
  return onAuthStateChanged(firebaseAuth(), onUser, onError)
}

export async function prepareFirebaseSession(): Promise<Auth> {
  const auth = firebaseAuth()
  // Keep the session and ID token in memory only; sign-in is required again after reload.
  await setPersistence(auth, inMemoryPersistence)
  return auth
}

export async function completeGoogleRedirect(): Promise<void> {
  const auth = await prepareFirebaseSession()
  await getRedirectResult(auth, browserPopupRedirectResolver)
}

export async function signInWithGoogle(): Promise<'signed_in' | 'redirecting'> {
  const auth = await prepareFirebaseSession()
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  try {
    await signInWithPopup(auth, provider, browserPopupRedirectResolver)
    return 'signed_in'
  } catch (error) {
    const code = (error as { code?: string } | null)?.code
    if (code !== 'auth/popup-blocked' && code !== 'auth/operation-not-supported-in-this-environment') throw error
    sessionStorage.setItem('nestwise_auth_return_view', 'analyze')
    await signInWithRedirect(auth, provider, browserPopupRedirectResolver)
    return 'redirecting'
  }
}

export async function signOutFromGoogle(): Promise<void> {
  await signOut(firebaseAuth())
}

export async function getFreshFirebaseIdToken(user: User): Promise<string> {
  return user.getIdToken()
}

export function publicFirebaseConfigMatchesBackend(backendProjectId: string | undefined): boolean {
  return Boolean(firebaseClientConfigured() && backendProjectId && clientConfig.projectId === backendProjectId)
}
