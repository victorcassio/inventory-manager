import api from './client'
import type { FinancialTransaction, PaginatedResponse } from '@/types'

export interface FinancialListParams {
  page?: number
  limit?: number
  type?: string
  category?: string
  origin?: string
  isVoided?: boolean
  rentalId?: string
  paymentId?: string
  dateFrom?: string
  dateTo?: string
}

export const financialApi = {
  list: (params?: FinancialListParams) =>
    api
      .get<PaginatedResponse<FinancialTransaction>>('/financial/transactions', { params })
      .then(r => r.data),

  getById: (id: string) =>
    api.get<FinancialTransaction>(`/financial/transactions/${id}`).then(r => r.data),

  create: (data: unknown) =>
    api.post<FinancialTransaction>('/financial/transactions', data).then(r => r.data),

  update: (id: string, data: unknown) =>
    api.patch<FinancialTransaction>(`/financial/transactions/${id}`, data).then(r => r.data),

  void: (id: string, reason: string) =>
    api
      .delete(`/financial/transactions/${id}`, { data: { reason } })
      .then(r => r.data),
}
