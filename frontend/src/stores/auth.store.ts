import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { User } from '@/types'
import { setTokens, clearTokens, allowRefreshAgain } from '@/lib/api/client'

/** Persisted-shape version. Bump it when the stored user gains a field. */
export const AUTH_PERSIST_VERSION = 1

/**
 * A user as it may exist in localStorage, written by any past version of the
 * client: the timestamps added in the users/passwords work can be missing
 * entirely, which is exactly what migrate() repairs.
 */
type PersistedUser = Omit<User, 'emailVerifiedAt' | 'passwordSetAt'> &
  Partial<Pick<User, 'emailVerifiedAt' | 'passwordSetAt'>>

interface PersistedAuthState {
  user: PersistedUser | null
  accessToken: string | null
  refreshToken: string | null
  isAuthenticated: boolean
}

interface AuthState {
  user: User | null
  accessToken: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  setAuth: (user: User, accessToken: string, refreshToken: string) => void
  updateTokens: (accessToken: string, refreshToken: string) => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      setAuth: (user, accessToken, refreshToken) => {
        setTokens(accessToken, refreshToken)
        // sessionEnding is module-wide in client.ts, not tied to any one
        // session — an earlier logout attempt (possibly still finishing its
        // own network call) must not leave a BRAND NEW session unable to
        // refresh.
        allowRefreshAgain()
        set({ user, accessToken, refreshToken, isAuthenticated: true })
      },
      updateTokens: (accessToken, refreshToken) => {
        setTokens(accessToken, refreshToken)
        set({ accessToken, refreshToken })
      },
      clearAuth: () => {
        clearTokens()
        set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false })
      },
    }),
    {
      name: 'inventory-auth',
      // Rehydration is synchronous (localStorage + a synchronous migrate), and
      // AuthHydration in app/providers.tsx is what pushes the rehydrated tokens
      // into the axios client. There is deliberately no onRehydrateStorage
      // here. If this ever moves to an async storage or an async migrate, that
      // guarantee is gone and onRehydrateStorage calling setTokens becomes
      // mandatory — otherwise a rehydrated session renders as authenticated
      // while sending no Authorization header.
      storage: createJSONStorage(() => localStorage),
      // Bump this whenever the persisted user shape gains a field. A browser
      // that logged in before emailVerifiedAt/passwordSetAt existed rehydrates
      // a user object without those keys, and nothing refetches it — authApi.me
      // is never called, so the stored object survives until the next login.
      // Left alone, the type would promise `string | null` where the value is
      // actually undefined, and a `passwordSetAt === null` check would read
      // false for an account that genuinely has no password set.
      version: AUTH_PERSIST_VERSION,
      migrate: (persisted) => {
        // Deliberately NOT typed as AuthState: the whole point is that an old
        // payload lacks keys the current User promises. Typing it as User would
        // make TypeScript think the defaults below are always overwritten.
        const state = persisted as PersistedAuthState | undefined
        if (!state?.user) return state as unknown as AuthState
        // Defaults first, stored values second: a real value always wins.
        return {
          ...state,
          user: { emailVerifiedAt: null, passwordSetAt: null, ...state.user },
        } as AuthState
      },
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
)
