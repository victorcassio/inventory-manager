import { useNavigate } from 'react-router-dom'
import { CreditCard } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/feedback/EmptyState'
import { formatCurrency, formatDate } from '@/lib/formatters'
import type { DashboardRecentPayment } from '@/types'

const METHOD_LABELS: Record<string, string> = {
  cash: 'Dinheiro',
  pix: 'PIX',
  card: 'Cartão',
  transfer: 'Transferência',
}

interface Props {
  payments: DashboardRecentPayment[]
}

export function RecentPaymentsList({ payments }: Props) {
  const navigate = useNavigate()

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base">Pagamentos Recentes</CardTitle>
        <CreditCard className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {payments.length === 0 ? (
          <EmptyState title="Sem pagamentos" description="Nenhum pagamento recente." />
        ) : (
          <ul className="space-y-3">
            {payments.map(p => (
              <li
                key={p.id}
                className="flex items-center justify-between cursor-pointer hover:bg-muted rounded-md px-2 py-1 -mx-2 transition-colors"
                onClick={() => navigate(`/rentals/${p.rentalId}`)}
              >
                <div>
                  <p className="text-sm font-medium">#{p.contractNumber}</p>
                  <p className="text-xs text-muted-foreground">{p.customerName} · {METHOD_LABELS[p.method] ?? p.method}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-green-600 dark:text-green-400">{formatCurrency(p.amount)}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(p.paidAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
