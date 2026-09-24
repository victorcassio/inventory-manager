import api from './client'
import type { AdminUser, CreateUserResult, PaginatedResponse, UserRole } from '@/types'

export interface ListUsersParams {
  page?: number
  limit?: number
  search?: string
  role?: UserRole
  status?: 'active' | 'inactive'
}

export const usersApi = {
  list: (params?: ListUsersParams) =>
    api.get<PaginatedResponse<AdminUser>>('/users', { params }).then((r) => r.data),
  getById: (id: string) => api.get<AdminUser>(`/users/${id}`).then((r) => r.data),
  create: (data: { name: string; email: string; role: 'attendant' | 'financial' }) =>
    api.post<CreateUserResult>('/users', data).then((r) => r.data),
  update: (id: string, data: { name?: string; role?: 'attendant' | 'financial' }) =>
    api.patch<AdminUser>(`/users/${id}`, data).then((r) => r.data),
  updateStatus: (id: string, isActive: boolean) =>
    api.patch<AdminUser>(`/users/${id}/status`, { isActive }).then((r) => r.data),
  resendInvitation: (id: string) =>
    api.post<CreateUserResult>(`/users/${id}/resend-invitation`).then((r) => r.data),
  // 204: unwrap to void like every sibling, so an AxiosResponse (headers,
  // config, request) never reaches a React Query cache.
  revokeInvitation: (id: string) =>
    api.post<void>(`/users/${id}/revoke-invitation`).then(() => undefined),
}
