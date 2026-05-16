import { useQuery } from '@tanstack/react-query'
import { financialApi, type FinancialListParams } from '@/lib/api/financial.api'

export const financialKeys = {
  all:     ['financial'] as const,
  list:    (params?: object) => [...financialKeys.all, 'list', params] as const,
  summary: (params?: object) => [...financialKeys.all, 'summary', params] as const,
  detail:  (id: string)     => [...financialKeys.all, 'detail', id]  as const,
}

export function useFinancialTransactions(params?: FinancialListParams) {
  return useQuery({
    queryKey: financialKeys.list(params),
    queryFn:  () => financialApi.list(params),
  })
}
