import { useQuery } from '@tanstack/react-query'
import { financialApi } from '@/lib/api/financial.api'
import { financialKeys } from './useFinancialTransactions'

export function useFinancialTransaction(id: string) {
  return useQuery({
    queryKey: financialKeys.detail(id),
    queryFn:  () => financialApi.getById(id),
    enabled:  !!id,
  })
}
