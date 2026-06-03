import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  format, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  subMonths, startOfYear, endOfYear,
} from 'date-fns'
import { ChevronRight, Plus } from 'lucide-react'
import { FilterPanel } from '@/components/filters/FilterPanel'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { useFinancialTransactions } from '../hooks/useFinancialTransactions'
import { useFinancialSummary } from '../hooks/useFinancialSummary'
import { useAuthStore } from '@/stores/auth.store'
import { formatCurrency, formatDate } from '@/lib/formatters'
import { usePagination } from '@/hooks/usePagination'
import { PERMISSIONS } from '@/lib/permissions'
import { CATEGORY_LABELS, ORIGIN_LABELS } from '../schemas/financialTransaction.schema'
import type { FinancialTransactionType, FinancialTransactionCategory, FinancialTransactionOrigin } from '@/types'

type PeriodPreset = 'today' | 'this_week' | 'this_month' | 'last_month' | 'this_year' | 'custom'

function getPresetDates(preset: PeriodPreset): { dateFrom: string; dateTo: string } {
  const now  = new Date()
  const fmt  = (d: Date) => format(d, 'yyyy-MM-dd')
  switch (preset) {
    case 'today':      return { dateFrom: fmt(now), dateTo: fmt(now) }
    case 'this_week':  return { dateFrom: fmt(startOfWeek(now, { weekStartsOn: 1 })), dateTo: fmt(endOfWeek(now, { weekStartsOn: 1 })) }
    case 'this_month': return { dateFrom: fmt(startOfMonth(now)), dateTo: fmt(endOfMonth(now)) }
    case 'last_month': { const lm = subMonths(now, 1); return { dateFrom: fmt(startOfMonth(lm)), dateTo: fmt(endOfMonth(lm)) } }
    case 'this_year':  return { dateFrom: fmt(startOfYear(now)), dateTo: fmt(endOfYear(now)) }
    case 'custom':     return { dateFrom: '', dateTo: '' }
  }
}

const PRESET_LABELS: Record<PeriodPreset, string> = {
  today:      'Hoje',
  this_week:  'Esta semana',
  this_month: 'Este mês',
  last_month: 'Mês passado',
  this_year:  'Este ano',
  custom:     'Personalizado',
}

export function FinancialListPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { page, limit, setPage } = usePagination()

  const [preset, setPreset]         = useState<PeriodPreset>('this_month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo,   setCustomTo]   = useState('')
  const [type,     setType]     = useState('')
  const [category, setCategory] = useState('')
  const [origin,   setOrigin]   = useState('')

  const activeCount = [
    preset !== 'this_month',
    !!type,
    !!category,
    !!origin,
  ].filter(Boolean).length

  const filterSummary = [
    preset !== 'this_month' ? PRESET_LABELS[preset] : null,
    type ? (type === 'income' ? 'Entrada' : 'Saída') : null,
    category ? CATEGORY_LABELS[category as FinancialTransactionCategory] : null,
    origin ? ORIGIN_LABELS[origin as FinancialTransactionOrigin] : null,
  ].filter(Boolean).join(' · ')

  const handleClear = () => {
    setPreset('this_month'); setCustomFrom(''); setCustomTo('')
    setType(''); setCategory(''); setOrigin(''); setPage(1)
  }

  const canManage = user ? PERMISSIONS.financial.manage.includes(user.role) : false

  const periodDates =
    preset === 'custom'
      ? { dateFrom: customFrom || undefined, dateTo: customTo || undefined }
      : getPresetDates(preset)

  const filterParams = {
    ...periodDates,
    ...(type     ? { type:     type     as FinancialTransactionType }     : {}),
    ...(category ? { category: category as FinancialTransactionCategory } : {}),
    ...(origin   ? { origin:   origin   as FinancialTransactionOrigin }   : {}),
  }

  const { data, isLoading, isError, refetch } = useFinancialTransactions({ ...filterParams, page, limit })
  const { data: summary, isLoading: summaryLoading } = useFinancialSummary(filterParams)

  const handlePreset = (p: PeriodPreset) => { setPreset(p); setPage(1) }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Financeiro</h2>
          <p className="text-muted-foreground">Lançamentos financeiros</p>
        </div>
        {canManage && (
          <Button onClick={() => navigate('/financial/transactions/new')}>
            <Plus className="mr-2 h-4 w-4" />
            Novo Lançamento
          </Button>
        )}
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

        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end md:gap-4">
          <div className="space-y-1">
            <Label>Tipo</Label>
            <Select value={type || 'all'} onValueChange={v => { setType(v === 'all' ? '' : v); setPage(1) }}>
              <SelectTrigger className="w-full md:w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="income">Entrada</SelectItem>
                <SelectItem value="expense">Saída</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Categoria</Label>
            <Select value={category || 'all'} onValueChange={v => { setCategory(v === 'all' ? '' : v); setPage(1) }}>
              <SelectTrigger className="w-full md:w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                  <SelectItem key={k} value={k}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Origem</Label>
            <Select value={origin || 'all'} onValueChange={v => { setOrigin(v === 'all' ? '' : v); setPage(1) }}>
              <SelectTrigger className="w-full md:w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {Object.entries(ORIGIN_LABELS).map(([k, label]) => (
                  <SelectItem key={k} value={k}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </FilterPanel>

      {/* Active chips — mobile only */}
      {activeCount > 0 && (
        <div className="flex flex-wrap gap-1 md:hidden">
          {preset !== 'this_month' && <Badge variant="secondary">{PRESET_LABELS[preset]}</Badge>}
          {type && <Badge variant="secondary">{type === 'income' ? 'Entrada' : 'Saída'}</Badge>}
          {category && <Badge variant="secondary">{CATEGORY_LABELS[category as FinancialTransactionCategory]}</Badge>}
          {origin && <Badge variant="secondary">{ORIGIN_LABELS[origin as FinancialTransactionOrigin]}</Badge>}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {summaryLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <Card className="border-green-200 bg-green-50 dark:bg-green-950 dark:border-green-800">
              <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">ENTRADAS</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold text-green-600 dark:text-green-400">{formatCurrency(summary?.totalIncome ?? 0)}</p></CardContent>
            </Card>
            <Card className="border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-800">
              <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">SAÍDAS</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold text-red-600 dark:text-red-400">{formatCurrency(summary?.totalExpense ?? 0)}</p></CardContent>
            </Card>
            <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800">
              <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">SALDO</CardTitle></CardHeader>
              <CardContent>
                <p className={`text-2xl font-bold ${(summary?.balance ?? 0) >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-red-600 dark:text-red-400'}`}>
                  {formatCurrency(summary?.balance ?? 0)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">ANULADOS</CardTitle></CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-muted-foreground">{summary?.voidedCount ?? 0}</p>
                <p className="text-xs text-muted-foreground">lançamentos</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Table */}
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
              title="Nenhum lançamento encontrado"
              description="Ajuste os filtros ou crie um novo lançamento."
              action={canManage ? { label: 'Novo Lançamento', onClick: () => navigate('/financial/transactions/new') } : undefined}
            />
          ) : (
            <>
              {/* Desktop */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead>Categoria</TableHead>
                      <TableHead>Origem</TableHead>
                      <TableHead>Locação</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.data.map(txn => (
                      <TableRow
                        key={txn.id}
                        className={`cursor-pointer ${txn.isVoided ? 'opacity-50' : ''}`}
                        onClick={() => navigate(`/financial/transactions/${txn.id}`)}
                      >
                        <TableCell className="text-muted-foreground text-sm">{formatDate(txn.date)}</TableCell>
                        <TableCell className={txn.isVoided ? 'line-through' : ''}>{txn.description}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{CATEGORY_LABELS[txn.category] ?? txn.category}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {ORIGIN_LABELS[txn.origin] ?? txn.origin}
                        </TableCell>
                        <TableCell>
                          {txn.rental ? (
                            <span
                              className="text-primary font-mono text-xs hover:underline"
                              onClick={e => { e.stopPropagation(); navigate(`/rentals/${txn.rentalId}`) }}
                            >
                              #{txn.rental.contractNumber}
                            </span>
                          ) : '—'}
                        </TableCell>
                        <TableCell
                          className={`text-right font-semibold ${
                            txn.isVoided
                              ? 'line-through text-muted-foreground'
                              : txn.type === 'income' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                          }`}
                        >
                          {txn.type === 'income' ? '+' : '−'}{formatCurrency(txn.amount)}
                        </TableCell>
                        <TableCell>
                          {txn.isVoided ? (
                            <Badge variant="destructive" className="text-xs">anulado</Badge>
                          ) : (
                            <span className="text-muted-foreground">›</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile */}
              <div className="md:hidden divide-y rounded-md border">
                {data.data.map(txn => (
                  <div
                    key={txn.id}
                    className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/50 ${txn.isVoided ? 'opacity-50' : ''}`}
                    onClick={() => navigate(`/financial/transactions/${txn.id}`)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className={`font-medium text-sm truncate ${txn.isVoided ? 'line-through' : ''}`}>
                        {txn.description}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(txn.date)} · {CATEGORY_LABELS[txn.category] ?? txn.category}
                      </p>
                    </div>
                    <span className={`text-sm font-semibold shrink-0 ${txn.isVoided ? 'line-through text-muted-foreground' : txn.type === 'income' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {txn.type === 'income' ? '+' : '−'}{formatCurrency(txn.amount)}
                    </span>
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
