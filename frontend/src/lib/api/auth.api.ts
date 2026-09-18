import api from './client'
import type { User, AuthTokens } from '@/types'

export const authApi = {
  login: (email: string, password: string) =>
    api.post<AuthTokens & { user: User }>('/auth/login', { email, password }).then(r => r.data),
  refresh: (refreshToken: string) =>
    api.post<AuthTokens>('/auth/refresh', { refreshToken }).then(r => r.data),
  // Bounded, unlike the rest of this file: this call is "best-effort" by
  // design (see endSession.ts) — a stalled response must not stall whatever
  // is awaiting it, since prepareToEndSession() has already gated refreshing
  // for the tab and nothing un-gates it until this resolves one way or the
  // other.
  logout: (refreshToken: string) =>
    api.post('/auth/logout', { refreshToken }, { timeout: 5000 }),
  me: () => api.get<User>('/auth/me').then(r => r.data),
  // 204 with no body, deliberately: activation does not log the user in, it
  // sends them to the login screen. Typing it void keeps a caller from
  // destructuring tokens that the endpoint will never return.
  activateAccount: (token: string, password: string, passwordConfirmation: string) =>
    api
      .post<void>('/auth/activate-account', { token, password, passwordConfirmation })
      .then(() => undefined),
  forgotPassword: (email: string) =>
    api.post<{ message: string }>('/auth/forgot-password', { email }).then((r) => r.data),
  resetPassword: (token: string, password: string, passwordConfirmation: string) =>
    api
      .post<void>('/auth/reset-password', { token, password, passwordConfirmation })
      .then(() => undefined),
  changePassword: (
    currentPassword: string,
    newPassword: string,
    newPasswordConfirmation: string,
  ) =>
    api
      .post<void>('/auth/change-password', {
        currentPassword,
        newPassword,
        newPasswordConfirmation,
      })
      .then(() => undefined),
}
