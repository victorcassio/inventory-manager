import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { User } from '@/types'
import { setTokens, clearTokens } from '@/lib/api/client'

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
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
)
