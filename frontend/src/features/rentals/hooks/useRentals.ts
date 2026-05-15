import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { rentalsApi } from '@/lib/api/rentals.api'
import type { AxiosError } from 'axios'

export const rentalKeys = {
  all: ['rentals'] as const,
  list: (params?: object) => [...rentalKeys.all, 'list', params] as const,
  detail: (id: string) => [...rentalKeys.all, 'detail', id] as const,
}

export function useRentals(params?: { page?: number; limit?: number; status?: string; computedStatus?: string; customerId?: string }) {
  return useQuery({
    queryKey: rentalKeys.list(params),
    queryFn: () => rentalsApi.list(params),
  })
}

export function useRental(id: string) {
  return useQuery({
    queryKey: rentalKeys.detail(id),
    queryFn: () => rentalsApi.getById(id),
    enabled: !!id,
  })
}

export function useCreateRental() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: rentalsApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: rentalKeys.all })
      toast.success('Locação criada com sucesso')
    },
    onError: (error: AxiosError<{ message?: string }>) => {
      const message = error.response?.data?.message ?? 'Erro ao criar locação'
      toast.error(message)
    },
  })
}

export function useCancelRental() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => rentalsApi.cancel(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: rentalKeys.all })
      toast.success('Locação cancelada')
    },
    onError: () => toast.error('Erro ao cancelar locação'),
  })
}
