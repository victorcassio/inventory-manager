import api from './client'
import type { Payment, PaginatedResponse } from '@/types'

export const paymentsApi = {
  getByRental: (rentalId: string) =>
    api.get<Payment[]>(`/rentals/${rentalId}/payments`).then(r => r.data),
  getById: (paymentId: string) =>
    api.get<Payment>(`/payments/${paymentId}`).then(r => r.data),
  list: (params?: { rentalId?: string; method?: string; dateFrom?: string; dateTo?: string; page?: number; limit?: number }) =>
    api.get<PaginatedResponse<Payment>>('/payments', { params }).then(r => r.data),
  create: (rentalId: string, data: unknown) =>
    api.post<Payment>(`/rentals/${rentalId}/payments`, data).then(r => r.data),
}
