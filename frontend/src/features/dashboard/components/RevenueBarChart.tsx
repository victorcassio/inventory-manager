import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
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

export function RevenueBarChart({ data }: Props) {
  const hasData = data.some(d => d.income > 0 || d.expense > 0)

  const chartData = data.map(d => ({
    month: formatMonth(d.month),
    Receita: d.income,
    Despesas: d.expense,
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Receita × Despesas (6 meses)</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <EmptyState title="Sem dados" description="Nenhuma transação nos últimos 6 meses." />
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(value: number) => formatCurrency(value)} />
              <Legend />
              <Bar dataKey="Receita" fill="#16a34a" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Despesas" fill="#dc2626" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
