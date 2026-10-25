import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LeaseServiceStatus } from '../types/rental'
import { LeaseInput } from '../components/LeaseInput'
import { extractLeaseText } from '../lib/rentalApi'

const authState = vi.hoisted(() => ({ listener: undefined as ((user: unknown) => void) | undefined }))
vi.mock('../lib/firebaseAuth', () => ({
  firebaseClientConfigured: () => true,
  prepareFirebaseSession: vi.fn().mockResolvedValue(undefined),
  completeGoogleRedirect: vi.fn().mockResolvedValue(undefined),
  watchFirebaseUser: vi.fn((listener: (user: unknown) => void) => { authState.listener = listener; listener(null); return () => { authState.listener = undefined } }),
  signInWithGoogle: vi.fn().mockResolvedValue('signed_in'),
  signOutFromGoogle: vi.fn().mockResolvedValue(undefined),
}))

const protectedStatus: LeaseServiceStatus = {
  configured: true, model: 'test-model', service_ready: true,
  authentication_required: true, firebase_project_id: 'nestwise-test',
}

describe('Firebase protected lease experience', () => {
  beforeEach(() => { authState.listener = undefined; vi.restoreAllMocks() })

  it('prompts signed-out visitors to continue with Google and keeps manual analysis available', () => {
    const signIn = vi.fn()
    render(<LeaseInput status={protectedStatus} busy={false} error={null} authConfigured={true} authUser={false} onSignIn={signIn} onText={vi.fn()} onPdf={vi.fn()}/> )
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
    expect(screen.getByText(/enter rental terms manually/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Lease provisions')).not.toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))
    expect(signIn).toHaveBeenCalledOnce()
  })

  it('keeps typed lease text in the mounted form when sign-in expires', () => {
    const view = (authenticated: boolean, authError?: string) => <LeaseInput status={protectedStatus} busy={false} error={null} authConfigured={true} authUser={authenticated} authError={authError} onSignIn={vi.fn()} onSignOut={vi.fn()} onText={vi.fn()} onPdf={vi.fn()}/> 
    const rendered = render(view(true))
    fireEvent.change(screen.getByLabelText('Lease provisions'), { target: { value: 'SYNTHETIC PRIVATE TEXT STAYS IN MEMORY' } })
    rendered.rerender(view(false, 'Your Google sign-in expired. Your lease text is still here.'))
    expect(screen.getByRole('alert')).toHaveTextContent(/sign-in expired/)
    expect(screen.getByLabelText('Lease provisions')).toHaveValue('SYNTHETIC PRIVATE TEXT STAYS IN MEMORY')
  })

  it('sends a Firebase bearer token only with the protected extraction request', async () => {
    const draft = { draft_id: 'draft-1', terms: [{ field_id: 'rental_label', value: 'Synthetic', status: 'explicit' }], general_warnings: [], review_required: true, source_type: 'pasted_text' }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(draft), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await extractLeaseText('Synthetic lease only.', 'synthetic-firebase-id-token')
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/lease/extract-text')
    expect((options as RequestInit).headers).toMatchObject({ Authorization: 'Bearer synthetic-firebase-id-token' })
    expect((options as RequestInit).body).toContain('Synthetic lease only.')
    expect(localStorage.length).toBe(0)
  })

  it('observes Firebase auth changes and exposes sign-in state', async () => {
    const { useFirebaseGoogleAuth } = await import('../hooks/useFirebaseGoogleAuth')
    function AuthStateView() {
      const auth = useFirebaseGoogleAuth()
      return <div>{auth.loading ? 'checking' : auth.user ? 'signed in' : 'signed out'}</div>
    }
    render(<AuthStateView/> )
    await waitFor(() => expect(authState.listener).toBeDefined())
    await waitFor(() => expect(screen.getByText('signed out')).toBeInTheDocument())
    const fakeUser = { uid: 'test-user' }
    act(() => authState.listener?.(fakeUser))
    expect(screen.getByText('signed in')).toBeInTheDocument()
  })
})
