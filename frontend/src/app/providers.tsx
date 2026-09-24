import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { Toaster } from 'sonner'
import { useEffect } from 'react'
import { useAuthStore } from '@/stores/auth.store'
import { setTokens } from '@/lib/api/client'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000, gcTime: 5 * 60 * 1000 },
  },
})

/**
 * A result announced by the axios client always names the refresh token that
 * asked for it. That name is what binds the result to a session.
 */
interface RefreshEventDetail {
  accessToken?: unknown
  refreshToken?: unknown
  sourceRefreshToken?: unknown
  reason?: unknown
}

/**
 * True only when the event belongs to the session that is live right now.
 *
 * `isAuthenticated` on its own is not enough: after a logout and a fresh login
 * it is true again, for a DIFFERENT session, and an in-flight result from the
 * old one would sail straight through. Comparing the originating refresh token
 * is what distinguishes "still me" from "someone, possibly me again".
 */
function belongsToCurrentSession(sourceRefreshToken: unknown) {
  const state = useAuthStore.getState()
  return (
    state.isAuthenticated &&
    typeof sourceRefreshToken === 'string' &&
    state.refreshToken === sourceRefreshToken
  )
}

function AuthHydration({ children }: { children: React.ReactNode }) {
  const { accessToken, refreshToken } = useAuthStore()

  useEffect(() => {
    // Rehydrate tokens into axios client on mount
    if (accessToken && refreshToken) setTokens(accessToken, refreshToken)
  }, [accessToken, refreshToken])

  useEffect(() => {
    // Both handlers read the store through getState() rather than closing over
    // it, so the effect never needs to re-subscribe and a remount (StrictMode
    // included) cannot leave a stale listener behind holding an old session.
    const handleLogout = (e: Event) => {
      const { sourceRefreshToken, reason } = ((e as CustomEvent).detail ??
        {}) as RefreshEventDetail
      if (!useAuthStore.getState().isAuthenticated) return

      // The axios module reached a 401 holding no refresh token at all. There
      // is no token to correlate on, and no session it could possibly belong
      // to: whatever this store believes, it is stale. Honouring this is what
      // keeps a desync from becoming a session that can never be ended.
      if (reason === 'no-refresh-token') {
        useAuthStore.getState().clearAuth()
        return
      }

      if (!belongsToCurrentSession(sourceRefreshToken)) return
      useAuthStore.getState().clearAuth()
    }

    const handleRefresh = (e: Event) => {
      const { accessToken: at, refreshToken: rt, sourceRefreshToken } = ((e as CustomEvent)
        .detail ?? {}) as RefreshEventDetail
      if (!belongsToCurrentSession(sourceRefreshToken)) return
      if (typeof at !== 'string' || typeof rt !== 'string') return
      useAuthStore.getState().updateTokens(at, rt)
    }

    window.addEventListener('auth:logout', handleLogout)
    window.addEventListener('auth:tokens-refreshed', handleRefresh)
    return () => {
      window.removeEventListener('auth:logout', handleLogout)
      window.removeEventListener('auth:tokens-refreshed', handleRefresh)
    }
  }, [])

  return <>{children}</>
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthHydration>
        {children}
        <Toaster position="top-right" richColors />
        <ReactQueryDevtools initialIsOpen={false} />
      </AuthHydration>
    </QueryClientProvider>
  )
}
