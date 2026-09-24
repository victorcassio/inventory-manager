import { useAuthStore } from '@/stores/auth.store'
import { authApi } from '@/lib/api/auth.api'
import {
  beginEndingSession,
  waitForPendingRefresh,
  getRefreshToken,
} from '@/lib/api/client'

/**
 * Step one of ending a session: stop it from being extended.
 *
 * beginEndingSession() keeps a NEW refresh from starting; waitForPendingRefresh
 * lets one that is ALREADY running finish first, so whatever reads the
 * refresh token right after this resolves gets the CURRENT one — not one a
 * rotation completing moments later would silently invalidate. Split out from
 * revokeAndClearSession() so a caller that also needs to cancel/clear a
 * TanStack Query cache can do that in between, before the network call to
 * /auth/logout and before clearAuth() — cancelling in-flight queries after
 * the auth header is already gone just turns them into a burst of avoidable
 * 401s.
 */
export async function prepareToEndSession(): Promise<void> {
  beginEndingSession()
  await waitForPendingRefresh()
}

/**
 * Step two: best-effort revoke, then clear — but only if this call is still
 * the one in charge of the session by the time its network round trip
 * finishes.
 *
 * The naive version — read the token, await authApi.logout(token), clearAuth
 * in a finally — has two races, both reachable without a second tab:
 *
 * 1. A refresh already in flight when this runs can rotate the token while
 *    the logout request is still travelling. The backend's /auth/logout
 *    revokes by exact token match, and rotation already revoked the OLD one,
 *    so sending it revokes nothing — the NEW, live pair the rotation minted
 *    is never touched and stays valid server-side until it expires. Closed by
 *    prepareToEndSession() running first: nothing is rotating anymore by the
 *    time this function reads the token.
 * 2. The network call to /auth/logout can take long enough for the user to
 *    navigate to /login by hand and sign in again in the SAME tab before it
 *    resolves. Without a check, clearing afterward destroys the BRAND NEW
 *    session a moment after it was established. Closed by comparing the
 *    store's refresh token against the one being revoked, immediately before
 *    clearing — a mismatch means somebody else is in charge now, and this
 *    call backs off instead of clobbering them.
 *
 * Returns true when it actually ended the session (the caller should
 * navigate to /login), false when a newer session pre-empted it (the caller
 * must leave that session alone).
 */
export async function revokeAndClearSession(): Promise<boolean> {
  const tokenToRevoke = getRefreshToken()

  if (tokenToRevoke) {
    try {
      await authApi.logout(tokenToRevoke)
    } catch {
      // Best-effort: local cleanup still has to happen even if the server
      // could not be reached, or the token was already invalid — a
      // successful password change, for one, has already revoked it
      // server-side, so this call answering with a failure here is routine.
    }
  }

  if (tokenToRevoke && useAuthStore.getState().refreshToken !== tokenToRevoke) {
    return false
  }

  useAuthStore.getState().clearAuth()
  return true
}

/**
 * User-initiated logout: the two steps above, back to back. See each one's
 * own doc comment for the races this closes and why they are reachable
 * without a second browser tab.
 */
export async function endSession(): Promise<boolean> {
  await prepareToEndSession()
  return revokeAndClearSession()
}
