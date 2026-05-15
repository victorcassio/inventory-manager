import api from './client'
import type { Customer, PaginatedResponse } from '@/types'

export const customersApi = {
  list: (params?: { page?: number; limit?: number; name?: string; document?: string }) =>
    api.get<PaginatedResponse<Customer>>('/customers', { params }).then(r => r.data),
  getById: (id: string) => api.get<Customer>(`/customers/${id}`).then(r => r.data),
  create: (data: unknown) => api.post<Customer>('/customers', data).then(r => r.data),
  update: (id: string, data: unknown) => api.patch<Customer>(`/customers/${id}`, data).then(r => r.data),
  deactivate: (id: string) => api.delete(`/customers/${id}`),
}
