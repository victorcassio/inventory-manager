import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { paymentsApi } from '@/lib/api/payments.api'
import { rentalKeys } from '@/features/rentals/hooks/useRentals'
import type { AxiosError } from 'axios'

export const paymentKeys = {
  all: ['payments'] as const,
  list: (params?: object) => [...paymentKeys.all, 'list', params] as const,
  byRental: (rentalId: string) => [...paymentKeys.all, 'rental', rentalId] as const,
  detail: (id: string) => [...paymentKeys.all, 'detail', id] as const,
}

export function usePaymentsByRental(rentalId: string) {
  return useQuery({
    queryKey: paymentKeys.byRental(rentalId),
    queryFn: () => paymentsApi.getByRental(rentalId),
    enabled: !!rentalId,
  })
}

export function usePayment(paymentId: string) {
  return useQuery({
    queryKey: paymentKeys.detail(paymentId),
    queryFn: () => paymentsApi.getById(paymentId),
    enabled: !!paymentId,
  })
}

export function usePayments(params?: {
  rentalId?: string
  method?: string
  dateFrom?: string
  dateTo?: string
  page?: number
  limit?: number
}) {
  return useQuery({
    queryKey: paymentKeys.list(params),
    queryFn: () => paymentsApi.list(params),
  })
}

export function useCreatePayment(rentalId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: unknown) => paymentsApi.create(rentalId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: rentalKeys.detail(rentalId) })
      qc.invalidateQueries({ queryKey: rentalKeys.all })
      qc.invalidateQueries({ queryKey: paymentKeys.byRental(rentalId) })
      toast.success('Pagamento registrado com sucesso')
    },
    onError: (error: AxiosError<{ message?: string }>) => {
      const message = error.response?.data?.message ?? 'Erro ao registrar pagamento'
      toast.error(message)
    },
  })
}
