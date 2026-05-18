import api from './client'
import type { Rental, PaginatedResponse } from '@/types'

export const rentalsApi = {
  list: (params?: { page?: number; limit?: number; status?: string; computedStatus?: string; customerId?: string; contractNumber?: string }) =>
    api.get<PaginatedResponse<Rental>>('/rentals', { params }).then(r => r.data),
  getById: (id: string) => api.get<Rental>(`/rentals/${id}`).then(r => r.data),
  create: (data: unknown) => api.post<Rental>('/rentals', data).then(r => r.data),
  update: (id: string, data: unknown) => api.patch<Rental>(`/rentals/${id}`, data).then(r => r.data),
  cancel: (id: string) => api.post(`/rentals/${id}/cancel`),
}
