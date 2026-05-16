import { useQuery } from '@tanstack/react-query'
import { financialApi, type FinancialListParams } from '@/lib/api/financial.api'
import { financialKeys } from './useFinancialTransactions'
import type { FinancialSummary } from '@/types'

const SUMMARY_LIMIT = 10000

type SummaryParams = Omit<FinancialListParams, 'page' | 'limit' | 'isVoided'>

export function useFinancialSummary(params?: SummaryParams): {
  data: FinancialSummary | undefined
  isLoading: boolean
  isError: boolean
} {
  const { data, isLoading, isError } = useQuery({
    queryKey: financialKeys.summary(params),
    queryFn:  () => financialApi.list({ ...params, limit: SUMMARY_LIMIT }),
  })

  if (!data) return { data: undefined, isLoading, isError }

  const transactions = data.data
  const totalIncome  = transactions
    .filter(t => t.type === 'income'  && !t.isVoided)
    .reduce((sum, t) => sum + Number(t.amount), 0)
  const totalExpense = transactions
    .filter(t => t.type === 'expense' && !t.isVoided)
    .reduce((sum, t) => sum + Number(t.amount), 0)
  const voidedCount  = transactions.filter(t => t.isVoided).length

  return {
    data: { totalIncome, totalExpense, balance: totalIncome - totalExpense, voidedCount },
    isLoading,
    isError,
  }
}
