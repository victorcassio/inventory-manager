// src/features/payments/pages/PaymentsListPage.tsx
import { useState, useRef } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { FilterPanel } from '@/components/filters/FilterPanel'
import { usePayments } from '../hooks/usePayments'
import { useAuthStore } from '@/stores/auth.store'
import { rentalsApi } from '@/lib/api/rentals.api'
import { formatCurrency, formatDate } from '@/lib/formatters'
import { usePagination } from '@/hooks/usePagination'

type PeriodPreset = 'today' | 'this_week' | 'this_month' | 'custom'

function getPresetDates(preset: PeriodPreset): { dateFrom: string; dateTo: string } {
  const now = new Date()
  const fmt = (d: Date) => format(d, 'yyyy-MM-dd')
  switch (preset) {
    case 'today':      return { dateFrom: fmt(now), dateTo: fmt(now) }
    case 'this_week':  return { dateFrom: fmt(startOfWeek(now, { weekStartsOn: 1 })), dateTo: fmt(endOfWeek(now, { weekStartsOn: 1 })) }
    case 'this_month': return { dateFrom: fmt(startOfMonth(now)), dateTo: fmt(endOfMonth(now)) }
    case 'custom':     return { dateFrom: '', dateTo: '' }
  }
}

const PRESET_LABELS: Record<PeriodPreset, string> = {
  today: 'Hoje', this_week: 'Esta semana', this_month: 'Este mês', custom: 'Personalizado',
}

const METHOD_LABELS: Record<string, string> = {
  pix: 'PIX', cash: 'Dinheiro', card: 'Cartão', transfer: 'Transferência',
}

export function PaymentsListPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()

  if (user && user.role === 'attendant') return <Navigate to="/403" replace />

  const { page, limit, setPage } = usePagination()
  const [preset, setPreset]                 = useState<PeriodPreset>('this_month')
  const [customFrom, setCustomFrom]         = useState('')
  const [customTo, setCustomTo]             = useState('')
  const [method, setMethod]                 = useState('')
  const [contractSearch, setContractSearch] = useState('')
  const [rentalIdFilter, setRentalIdFilter] = useState<string | undefined>()
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  const periodDates =
    preset === 'custom'
      ? { dateFrom: customFrom || undefined, dateTo: customTo || undefined }
      : getPresetDates(preset)

  const { data, isLoading, isError, refetch } = usePayments({
    ...periodDates,
    method: method || undefined,
    rentalId: rentalIdFilter,
    page, limit,
  })

  const handlePreset = (p: PeriodPreset) => { setPreset(p); setPage(1) }

  const handleContractInput = (value: string) => {
    setContractSearch(value)
    clearTimeout(debounceRef.current)
    if (!value || value.length < 2) { setRentalIdFilter(undefined); setPage(1); return }
    debounceRef.current = setTimeout(async () => {
      try {
        const result = await rentalsApi.list({ contractNumber: value, limit: 5 })
        setRentalIdFilter(result.data[0]?.id ?? undefined)
        setPage(1)
      } catch { setRentalIdFilter(undefined) }
    }, 300)
  }

  const activeCount = [preset !== 'this_month', !!method, !!contractSearch].filter(Boolean).length

  const filterSummary = [
    preset !== 'this_month' ? PRESET_LABELS[preset] : null,
    method ? METHOD_LABELS[method] : null,
    contractSearch ? `#${contractSearch}` : null,
  ].filter(Boolean).join(' · ')

  const handleClear = () => {
    setPreset('this_month'); setCustomFrom(''); setCustomTo('')
    setMethod(''); setContractSearch(''); setRentalIdFilter(undefined); setPage(1)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Pagamentos</h2>
        <p className="text-muted-foreground">Histórico de pagamentos recebidos</p>
      </div>

      <FilterPanel activeCount={activeCount} summary={filterSummary} onClear={handleClear}>
        {/* Period presets */}
        <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap">
          {(Object.keys(PRESET_LABELS) as PeriodPreset[]).map(p => (
            <Button key={p} variant={preset === p ? 'default' : 'outline'} size="sm"
              className="w-full md:w-auto" onClick={() => handlePreset(p)}>
              {PRESET_LABELS[p]}
            </Button>
          ))}
        </div>

        {/* Custom date range */}
        {preset === 'custom' && (
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:gap-4">
            <div className="space-y-1">
              <Label htmlFor="dateFrom">De</Label>
              <DateInput id="dateFrom" value={customFrom} onChange={e => { setCustomFrom(e.target.value); setPage(1) }} className="w-full md:w-40" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dateTo">Até</Label>
              <DateInput id="dateTo" value={customTo} onChange={e => { setCustomTo(e.target.value); setPage(1) }} className="w-full md:w-40" />
            </div>
          </div>
        )}

        {/* Method + Contract */}
        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end md:gap-4">
          <div className="space-y-1">
            <Label>Método</Label>
            <Select value={method || 'all'} onValueChange={v => { setMethod(v === 'all' ? '' : v); setPage(1) }}>
              <SelectTrigger className="w-full md:w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {Object.entries(METHOD_LABELS).map(([k, label]) => (
                  <SelectItem key={k} value={k}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="contract">Contrato</Label>
            <Input id="contract" placeholder="Buscar por contrato..." value={contractSearch}
              onChange={e => handleContractInput(e.target.value)} className="w-full md:w-48" />
          </div>
        </div>
      </FilterPanel>

      {/* Active chips — mobile only */}
      {activeCount > 0 && (
        <div className="flex flex-wrap gap-1 md:hidden">
          {preset !== 'this_month' && <Badge variant="secondary">{PRESET_LABELS[preset]}</Badge>}
          {method && <Badge variant="secondary">{METHOD_LABELS[method]}</Badge>}
          {contractSearch && <Badge variant="secondary">#{contractSearch}</Badge>}
        </div>
      )}

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" role="status" />)}
        </div>
      )}
      {isError && <ErrorState onRetry={() => refetch()} />}

      {!isLoading && !isError && data && (
        <>
          {data.data.length === 0 ? (
            <EmptyState title="Nenhum pagamento encontrado" description="Ajuste os filtros para ver mais resultados." />
          ) : (
            <>
              {/* Desktop */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Contrato</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Método</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.data.map(payment => (
                      <TableRow key={payment.id}>
                        <TableCell className="text-muted-foreground text-sm">{formatDate(payment.paidAt)}</TableCell>
                        <TableCell>
                          {payment.rental ? (
                            <button className="font-mono text-xs text-primary hover:underline"
                              onClick={() => navigate(`/rentals/${payment.rentalId}`)}>
                              #{payment.rental.contractNumber}
                            </button>
                          ) : '—'}
                        </TableCell>
                        <TableCell>{payment.rental?.customer?.name ?? '—'}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{METHOD_LABELS[payment.method] ?? payment.method}</TableCell>
                        <TableCell className="text-right font-semibold text-green-600 dark:text-green-400">{formatCurrency(payment.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile */}
              <div className="md:hidden divide-y rounded-md border">
                {data.data.map(payment => (
                  <div key={payment.id} className="flex items-center gap-3 p-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{payment.rental?.customer?.name ?? '—'}</p>
                      <p className="text-xs text-muted-foreground">
                        {payment.rental ? `#${payment.rental.contractNumber}` : '—'} · {formatDate(payment.paidAt)}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-green-600 dark:text-green-400 shrink-0">{formatCurrency(payment.amount)}</span>
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
