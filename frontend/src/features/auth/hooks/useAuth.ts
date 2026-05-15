import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth.store'
import { authApi } from '@/lib/api/auth.api'

export function useAuth() {
  const navigate = useNavigate()
  const { user, isAuthenticated, setAuth, clearAuth } = useAuthStore()

  const login = useCallback(async (email: string, password: string) => {
    const data = await authApi.login(email, password)
    setAuth(data.user, data.accessToken, data.refreshToken)
    navigate('/dashboard', { replace: true })
  }, [setAuth, navigate])

  const logout = useCallback(async () => {
    const { refreshToken } = useAuthStore.getState()
    try {
      if (refreshToken) await authApi.logout(refreshToken)
    } catch {
      // ignore errors on logout
    } finally {
      clearAuth()
      navigate('/login', { replace: true })
    }
  }, [clearAuth, navigate])

  return { user, isAuthenticated, login, logout }
}
