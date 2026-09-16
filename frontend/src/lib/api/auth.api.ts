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
