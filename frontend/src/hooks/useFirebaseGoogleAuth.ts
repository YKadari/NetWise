import { useCallback, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { completeGoogleRedirect, firebaseClientConfigured, prepareFirebaseSession, signInWithGoogle, signOutFromGoogle, watchFirebaseUser } from '../lib/firebaseAuth'

export function useFirebaseGoogleAuth() {
  const configured = firebaseClientConfigured()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(configured)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!configured) { setLoading(false); return }
    let alive = true
    let unsubscribe: (() => void) | undefined
    void prepareFirebaseSession().then(async () => {
      if (!alive) return
      try { await completeGoogleRedirect() }
      catch { if (alive) setError('Google sign-in did not finish. Please try again or continue with manual analysis.') }
      if (!alive) return
      unsubscribe = watchFirebaseUser(next => { setUser(next); setLoading(false) }, () => {
        setUser(null); setLoading(false); setError('Google sign-in could not be checked. Please try again.')
      })
    }).catch(() => {
      if (alive) { setLoading(false); setError('Google sign-in is temporarily unavailable.') }
    })
    return () => { alive = false; unsubscribe?.() }
  }, [configured])

  const signIn = useCallback(async () => {
    setBusy(true); setError(null)
    try { await signInWithGoogle() }
    catch (cause) {
      const code = (cause as { code?: string } | null)?.code
      setError(code === 'auth/unauthorized-domain'
        ? 'This website is not yet enabled for Google sign-in. Please contact the demo host.'
        : code === 'auth/popup-closed-by-user'
          ? 'Sign-in was canceled. You can try again or continue with manual analysis.'
          : 'Google sign-in did not finish. Please try again or continue with manual analysis.')
    } finally { setBusy(false) }
  }, [])

  const signOut = useCallback(async () => {
    setBusy(true); setError(null)
    try { await signOutFromGoogle(); setUser(null) }
    catch { setError('Could not sign out right now. Please try again.') }
    finally { setBusy(false) }
  }, [])

  return { user, configured, loading, busy, error, signIn, signOut }
}
