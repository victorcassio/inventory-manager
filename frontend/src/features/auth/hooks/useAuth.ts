import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth.store'
import { authApi } from '@/lib/api/auth.api'
import { endSession } from '../lib/endSession'

export function useAuth() {
  const navigate = useNavigate()
  const { user, isAuthenticated, setAuth } = useAuthStore()

  const login = useCallback(async (email: string, password: string) => {
    const data = await authApi.login(email, password)
    setAuth(data.user, data.accessToken, data.refreshToken)
    navigate('/dashboard', { replace: true })
  }, [setAuth, navigate])

  const logout = useCallback(async () => {
    // Only navigate away if this call actually ended the session: a slow
    // /auth/logout can finish after the user has already signed into a new
    // session in this same tab, and that session is not this call's to end.
    const ended = await endSession()
    if (ended) navigate('/login', { replace: true })
  }, [navigate])

  return { user, isAuthenticated, login, logout }
}
