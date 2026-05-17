import { useNavigate } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/feedback/EmptyState'
import { formatDate } from '@/lib/formatters'
import type { DashboardOverdueReturn } from '@/types'

interface Props {
  returns: DashboardOverdueReturn[]
}

export function OverdueReturnsList({ returns }: Props) {
  const navigate = useNavigate()

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base">Devoluções Atrasadas</CardTitle>
        <AlertTriangle className="h-4 w-4 text-orange-500" />
      </CardHeader>
      <CardContent>
        {returns.length === 0 ? (
          <EmptyState title="Tudo em dia" description="Nenhuma devolução atrasada." />
        ) : (
          <ul className="space-y-3">
            {returns.map(r => (
              <li
                key={r.id}
                className="flex items-center justify-between cursor-pointer hover:bg-muted rounded-md px-2 py-1 -mx-2 transition-colors"
                onClick={() => navigate(`/rentals/${r.id}`)}
              >
                <div>
                  <p className="text-sm font-medium">#{r.contractNumber}</p>
                  <p className="text-xs text-muted-foreground">{r.customerName} · venceu {formatDate(r.expectedReturn)}</p>
                </div>
                <Badge variant="destructive" className="text-xs">
                  {r.daysOverdue}d
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
