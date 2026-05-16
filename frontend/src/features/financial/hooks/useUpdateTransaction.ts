import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { AxiosError } from 'axios'
import { financialApi } from '@/lib/api/financial.api'
import { financialKeys } from './useFinancialTransactions'

export function useUpdateTransaction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: unknown }) =>
      financialApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: financialKeys.all })
      toast.success('Lançamento atualizado com sucesso')
    },
    onError: (error: AxiosError<{ message?: string }>) => {
      const message = error.response?.data?.message ?? 'Erro ao atualizar lançamento'
      toast.error(message)
    },
  })
}
