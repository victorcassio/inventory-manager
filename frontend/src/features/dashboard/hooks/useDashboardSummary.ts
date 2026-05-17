import { useQuery } from '@tanstack/react-query'
import { dashboardApi } from '@/lib/api/dashboard.api'

export function useDashboardSummary() {
  return useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: dashboardApi.getSummary,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
}
