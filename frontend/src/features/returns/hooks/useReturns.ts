import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { returnsApi } from '@/lib/api/returns.api'
import { rentalKeys } from '@/features/rentals/hooks/useRentals'
import type { AxiosError } from 'axios'

export const returnKeys = {
  all: ['returns'] as const,
  byRental: (rentalId: string) => [...returnKeys.all, 'rental', rentalId] as const,
  detail: (id: string) => [...returnKeys.all, 'detail', id] as const,
}

export function useReturnsByRental(rentalId: string) {
  return useQuery({
    queryKey: returnKeys.byRental(rentalId),
    queryFn: () => returnsApi.getByRental(rentalId),
    enabled: !!rentalId,
  })
}

export function useReturn(returnId: string) {
  return useQuery({
    queryKey: returnKeys.detail(returnId),
    queryFn: () => returnsApi.getById(returnId),
    enabled: !!returnId,
  })
}

export function useCreateReturn(rentalId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: unknown) => returnsApi.create(rentalId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: rentalKeys.detail(rentalId) })
      qc.invalidateQueries({ queryKey: rentalKeys.all })
      qc.invalidateQueries({ queryKey: returnKeys.byRental(rentalId) })
      toast.success('Devolução registrada com sucesso')
    },
    onError: (error: AxiosError<{ message?: string }>) => {
      const message = error.response?.data?.message ?? 'Erro ao registrar devolução'
      toast.error(message)
    },
  })
}
