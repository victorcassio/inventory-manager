// src/features/rentals/pages/RentalsListPage.tsx
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronRight, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { StatusBadge } from '@/components/feedback/StatusBadge'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { useRentals } from '../hooks/useRentals'
import { useAuthStore } from '@/stores/auth.store'
import { formatDate, formatCurrency } from '@/lib/formatters'
import { usePagination } from '@/hooks/usePagination'
import type { ComputedRentalStatus } from '@/types'

const STATUS_OPTIONS = [
  { value: 'all', label: 'Todos os status' },
  { value: 'active', label: 'Ativo' },
  { value: 'overdue', label: 'Vencido' },
  { value: 'returned', label: 'Devolvido' },
  { value: 'canceled', label: 'Cancelado' },
]

export function RentalsListPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user } = useAuthStore()
  const [computedStatus, setComputedStatus] = useState<string>(
    searchParams.get('status') ?? ''
  )
  const { page, limit, setPage } = usePagination()
  const canManage = user?.role === 'admin' || user?.role === 'attendant'

  const { data, isLoading, isError, refetch } = useRentals({
    page, limit,
    computedStatus: computedStatus || undefined,
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Locações</h2>
        {canManage && (
          <Button onClick={() => navigate('/rentals/new')}>
            <Plus className="mr-2 h-4 w-4" />
            Nova Locação
          </Button>
        )}
      </div>

      <div className="max-w-xs">
        <Select
          value={computedStatus || 'all'}
          onValueChange={(v) => { setComputedStatus(v === 'all' ? '' : v); setPage(1) }}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      )}
      {isError && <ErrorState onRetry={() => refetch()} />}

      {!isLoading && !isError && data && (
        <>
          {data.data.length === 0 ? (
            <EmptyState
              title="Nenhuma locação encontrada"
              description="Crie a primeira locação."
              action={canManage ? { label: 'Nova Locação', onClick: () => navigate('/rentals/new') } : undefined}
            />
          ) : (
            <>
              {/* Desktop */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Contrato</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Início</TableHead>
                      <TableHead>Devolução</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.data.map(rental => (
                      <TableRow key={rental.id} className="cursor-pointer" onClick={() => navigate(`/rentals/${rental.id}`)}>
                        <TableCell className="font-mono text-xs">{rental.contractNumber}</TableCell>
                        <TableCell>{rental.customer?.name ?? '—'}</TableCell>
                        <TableCell>{formatDate(rental.startedAt)}</TableCell>
                        <TableCell>{formatDate(rental.expectedReturn)}</TableCell>
                        <TableCell><StatusBadge status={rental.computedStatus as ComputedRentalStatus} /></TableCell>
                        <TableCell>{rental.total ? formatCurrency(rental.total) : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile */}
              <div className="md:hidden divide-y rounded-md border">
                {data.data.map(rental => (
                  <div
                    key={rental.id}
                    className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/rentals/${rental.id}`)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{rental.customer?.name ?? '—'}</p>
                      <p className="text-xs text-muted-foreground">
                        {rental.contractNumber} · {formatDate(rental.startedAt)} → {formatDate(rental.expectedReturn)}
                      </p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      <StatusBadge status={rental.computedStatus as ComputedRentalStatus} />
                      <span className="text-xs font-medium">{rental.total ? formatCurrency(rental.total) : '—'}</span>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </div>
                ))}
              </div>
            </>
          )}

          {data.total > limit && (
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <p className="text-sm text-muted-foreground">
                Mostrando {(page - 1) * limit + 1}–{Math.min(page * limit, data.total)} de {data.total}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button>
                <Button variant="outline" size="sm" disabled={page * limit >= data.total} onClick={() => setPage(page + 1)}>Próxima</Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
