import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/feedback/EmptyState'
import { formatCurrency } from '@/lib/formatters'
import type { DashboardMonthlyHistory } from '@/types'

function formatMonth(monthStr: string): string {
  const [year, month] = monthStr.split('-')
  const date = new Date(Number(year), Number(month) - 1, 1)
  return date.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
    .replace(/\./g, '').replace(' de ', '/').replace(' ', '/')
}

interface Props {
  data: DashboardMonthlyHistory[]
}

export function CumulativeLineChart({ data }: Props) {
  const hasData = data.some(d => d.cumulativeIncome > 0)

  const chartData = data.map(d => ({
    month: formatMonth(d.month),
    'Receita Acumulada': d.cumulativeIncome,
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Receita Acumulada (6 meses)</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <EmptyState title="Sem dados" description="Nenhuma receita nos últimos 6 meses." />
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="incomeGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(value) => formatCurrency(Number(value ?? 0))} />
              <Area
                type="monotone"
                dataKey="Receita Acumulada"
                stroke="#6366f1"
                strokeWidth={2}
                fill="url(#incomeGradient)"
                activeDot={{ r: 3, fill: '#6366f1' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
