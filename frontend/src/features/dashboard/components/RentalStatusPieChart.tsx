import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/feedback/EmptyState'
import type { DashboardRentals } from '@/types'

const COLORS = ['#6366f1', '#f97316', '#94a3b8', '#ef4444']

interface Props {
  data: DashboardRentals
}

export function RentalStatusPieChart({ data }: Props) {
  const chartData = [
    { name: 'Ativas', value: data.byStatus.active },
    { name: 'Vencidas', value: data.byStatus.overdue },
    { name: 'Finalizadas', value: data.byStatus.returned },
    { name: 'Canceladas', value: data.byStatus.canceled },
  ].filter(d => d.value > 0)

  const hasData = chartData.some(d => d.value > 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Locações por Status</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <EmptyState title="Sem locações" description="Nenhuma locação registrada." />
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={85}
                dataKey="value"
              >
                {chartData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
