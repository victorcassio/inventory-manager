import api from './client'
import type { Return } from '@/types'

export const returnsApi = {
  getByRental: (rentalId: string) =>
    api.get<Return[]>(`/rentals/${rentalId}/returns`).then(r => r.data),
  getById: (returnId: string) =>
    api.get<Return>(`/returns/${returnId}`).then(r => r.data),
  create: (rentalId: string, data: unknown) =>
    api.post<Return>(`/rentals/${rentalId}/returns`, data).then(r => r.data),
}
