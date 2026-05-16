import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { AxiosError } from 'axios'
import { financialApi } from '@/lib/api/financial.api'
import { financialKeys } from './useFinancialTransactions'

export function useCreateTransaction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: financialApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: financialKeys.all })
      toast.success('Lançamento criado com sucesso')
    },
    onError: (error: AxiosError<{ message?: string }>) => {
      const message = error.response?.data?.message ?? 'Erro ao criar lançamento'
      toast.error(message)
    },
  })
}
