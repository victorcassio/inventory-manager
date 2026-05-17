import { useNavigate } from 'react-router-dom'
import { Calendar } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/feedback/EmptyState'
import { formatDate } from '@/lib/formatters'
import type { DashboardUpcomingReturn } from '@/types'

interface Props {
  returns: DashboardUpcomingReturn[]
}

export function UpcomingReturnsList({ returns }: Props) {
  const navigate = useNavigate()

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base">Próximas Devoluções</CardTitle>
        <Calendar className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {returns.length === 0 ? (
          <EmptyState title="Nenhuma prevista" description="Sem devoluções nos próximos 7 dias." />
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
                  <p className="text-xs text-muted-foreground">{r.customerName}</p>
                </div>
                <p className="text-sm text-muted-foreground">{formatDate(r.expectedReturn)}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
