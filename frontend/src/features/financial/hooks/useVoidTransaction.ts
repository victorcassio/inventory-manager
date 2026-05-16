import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { AxiosError } from 'axios'
import { financialApi } from '@/lib/api/financial.api'
import { financialKeys } from './useFinancialTransactions'

export function useVoidTransaction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      financialApi.void(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: financialKeys.all })
      toast.success('Lançamento anulado com sucesso')
    },
    onError: (error: AxiosError<{ message?: string }>) => {
      const message = error.response?.data?.message ?? 'Erro ao anular lançamento'
      toast.error(message)
    },
  })
}
