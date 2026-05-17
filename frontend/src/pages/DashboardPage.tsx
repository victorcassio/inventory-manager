import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/feedback/ErrorState'
import { useDashboardSummary } from '@/features/dashboard/hooks/useDashboardSummary'
import { FinancialSection } from '@/features/dashboard/components/FinancialSection'
import { RentalsSection } from '@/features/dashboard/components/RentalsSection'
import { InventorySection } from '@/features/dashboard/components/InventorySection'
import { RevenueBarChart } from '@/features/dashboard/components/RevenueBarChart'
import { CumulativeLineChart } from '@/features/dashboard/components/CumulativeLineChart'
import { RentalStatusPieChart } from '@/features/dashboard/components/RentalStatusPieChart'
import { InventoryOccupancyBar } from '@/features/dashboard/components/InventoryOccupancyBar'
import { RecentPaymentsList } from '@/features/dashboard/components/RecentPaymentsList'
import { UpcomingReturnsList } from '@/features/dashboard/components/UpcomingReturnsList'
import { OverdueReturnsList } from '@/features/dashboard/components/OverdueReturnsList'

export function DashboardPage() {
  const { data, isLoading, isError, refetch } = useDashboardSummary()

  if (isLoading) {
    return (
      <div className="space-y-6">
        <p className="text-muted-foreground">Carregando dashboard...</p>
        <div className="grid gap-4 grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <div className="grid gap-4 grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-72" />)}
        </div>
      </div>
    )
  }

  if (isError || !data) {
    return <ErrorState onRetry={() => refetch()} />
  }

  const { permissions, financial, rentals, inventory, monthlyHistory } = data

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold">Dashboard</h2>
        <p className="text-muted-foreground">
          Visão geral — {data.period.currentMonth}
        </p>
      </div>

      {/* KPI Sections */}
      <div className="space-y-6">
        {permissions.canViewFinancial && financial && (
          <FinancialSection data={financial} />
        )}
        {permissions.canViewOperational && (
          <RentalsSection data={rentals} />
        )}
        {permissions.canViewInventory && (
          <InventorySection data={inventory} />
        )}
      </div>

      {/* Charts */}
      <div className="grid gap-6 md:grid-cols-2">
        {permissions.canViewFinancial && (
          <RevenueBarChart data={monthlyHistory} />
        )}
        {permissions.canViewFinancial && (
          <CumulativeLineChart data={monthlyHistory} />
        )}
        {permissions.canViewOperationalCharts && (
          <RentalStatusPieChart data={rentals} />
        )}
        {permissions.canViewOperationalCharts && (
          <InventoryOccupancyBar data={inventory} />
        )}
      </div>

      {/* Lists */}
      <div className="grid gap-6 md:grid-cols-3">
        {permissions.canViewFinancial && financial && (
          <RecentPaymentsList payments={financial.recentPayments} />
        )}
        {permissions.canViewOperational && (
          <UpcomingReturnsList returns={rentals.upcomingReturns} />
        )}
        {permissions.canViewOperational && (
          <OverdueReturnsList returns={rentals.overdueReturns} />
        )}
      </div>
    </div>
  )
}
