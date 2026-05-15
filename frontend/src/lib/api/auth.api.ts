import api from './client'
import type { User, AuthTokens } from '@/types'

export const authApi = {
  login: (email: string, password: string) =>
    api.post<AuthTokens & { user: User }>('/auth/login', { email, password }).then(r => r.data),
  refresh: (refreshToken: string) =>
    api.post<AuthTokens>('/auth/refresh', { refreshToken }).then(r => r.data),
  logout: (refreshToken: string) =>
    api.post('/auth/logout', { refreshToken }),
  me: () => api.get<User>('/auth/me').then(r => r.data),
}
