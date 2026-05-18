import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns'
import { Download, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { useDocuments, useDownloadDocument } from '../hooks/useDocuments'
import { usePagination } from '@/hooks/usePagination'
import { rentalsApi } from '@/lib/api/rentals.api'
import { formatDate } from '@/lib/formatters'
import type { DocumentType, DocumentStatus } from '@/types'

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
  today:      'Hoje',
  this_week:  'Esta semana',
  this_month: 'Este mês',
  custom:     'Personalizado',
}

const TYPE_LABELS: Record<DocumentType, string> = {
  contract:     'Contrato',
  receipt:      'Recibo',
  return_proof: 'Comprovante de Devolução',
}

const STATUS_LABELS: Record<DocumentStatus, string> = {
  generated: 'Gerado',
  voided:    'Anulado',
}

const STATUS_VARIANT: Record<DocumentStatus, 'default' | 'outline'> = {
  generated: 'default',
  voided:    'outline',
}

export function DocumentsListPage() {
  const navigate = useNavigate()
  const { page, limit, setPage } = usePagination()
  const [preset, setPreset]                 = useState<PeriodPreset>('this_month')
  const [customFrom, setCustomFrom]         = useState('')
  const [customTo, setCustomTo]             = useState('')
  const [docType, setDocType]               = useState('')
  const [docStatus, setDocStatus]           = useState('')
  const [contractSearch, setContractSearch] = useState('')
  const [rentalIdFilter, setRentalIdFilter] = useState<string | undefined>()
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  const download = useDownloadDocument()

  const periodDates =
    preset === 'custom'
      ? { dateFrom: customFrom || undefined, dateTo: customTo || undefined }
      : getPresetDates(preset)

  const { data, isLoading, isError, refetch } = useDocuments({
    ...periodDates,
    type:     docType || undefined,
    status:   docStatus || undefined,
    rentalId: rentalIdFilter,
    page,
    limit,
  })

  const handlePreset = (p: PeriodPreset) => { setPreset(p); setPage(1) }

  const handleContractInput = (value: string) => {
    setContractSearch(value)
    clearTimeout(debounceRef.current)
    if (!value || value.length < 2) {
      setRentalIdFilter(undefined)
      setPage(1)
      return
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const result = await rentalsApi.list({ contractNumber: value, limit: 5 })
        setRentalIdFilter(result.data[0]?.id ?? undefined)
        setPage(1)
      } catch {
        setRentalIdFilter(undefined)
      }
    }, 300)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold">Documentos</h2>
        <p className="text-muted-foreground">Contratos, recibos e comprovantes gerados</p>
      </div>

      {/* Period presets */}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(PRESET_LABELS) as PeriodPreset[]).map(p => (
          <Button key={p} variant={preset === p ? 'default' : 'outline'} size="sm" onClick={() => handlePreset(p)}>
            {PRESET_LABELS[p]}
          </Button>
        ))}
      </div>

      {/* Custom date range */}
      {preset === 'custom' && (
        <div className="flex gap-4 items-end flex-wrap">
          <div className="space-y-1">
            <Label htmlFor="dateFrom">De</Label>
            <Input id="dateFrom" type="date" value={customFrom} onChange={e => { setCustomFrom(e.target.value); setPage(1) }} className="w-40" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="dateTo">Até</Label>
            <Input id="dateTo" type="date" value={customTo} onChange={e => { setCustomTo(e.target.value); setPage(1) }} className="w-40" />
          </div>
        </div>
      )}

      {/* Type + Status + Contract filters */}
      <div className="flex gap-4 flex-wrap items-end">
        <div className="space-y-1">
          <Label>Tipo</Label>
          <Select value={docType || 'all'} onValueChange={v => { setDocType(v === 'all' ? '' : v); setPage(1) }}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="contract">Contrato</SelectItem>
              <SelectItem value="receipt">Recibo</SelectItem>
              <SelectItem value="return_proof">Comprovante de Devolução</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Status</Label>
          <Select value={docStatus || 'all'} onValueChange={v => { setDocStatus(v === 'all' ? '' : v); setPage(1) }}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="generated">Gerado</SelectItem>
              <SelectItem value="voided">Anulado</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="contract">Contrato</Label>
          <Input
            id="contract"
            placeholder="Buscar por contrato..."
            value={contractSearch}
            onChange={e => handleContractInput(e.target.value)}
            className="w-48"
          />
        </div>
      </div>

      {/* Table */}
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" role="status" />
          ))}
        </div>
      )}

      {isError && <ErrorState onRetry={() => refetch()} />}

      {!isLoading && !isError && data && (
        <>
          {data.data.length === 0 ? (
            <EmptyState title="Nenhum documento encontrado" description="Ajuste os filtros para ver mais resultados." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Contrato</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Arquivo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map(doc => (
                  <TableRow key={doc.id}>
                    <TableCell className="text-muted-foreground text-sm">{formatDate(doc.createdAt)}</TableCell>
                    <TableCell>{TYPE_LABELS[doc.type] ?? doc.type}</TableCell>
                    <TableCell>
                      {doc.rental ? (
                        <button
                          className="font-mono text-xs text-primary hover:underline"
                          onClick={() => navigate(`/rentals/${doc.rentalId}`)}
                        >
                          #{doc.rental.contractNumber}
                        </button>
                      ) : '—'}
                    </TableCell>
                    <TableCell>{doc.rental?.customer?.name ?? '—'}</TableCell>
                    <TableCell className="max-w-[180px] truncate text-sm text-muted-foreground">
                      {doc.filename}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[doc.status] ?? 'secondary'}>
                        {STATUS_LABELS[doc.status] ?? doc.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={download.isPending || doc.status === 'voided'}
                          onClick={() => download.mutate({ documentId: doc.id, filename: doc.filename })}
                          title="Baixar PDF"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        {doc.rentalId && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => navigate(`/rentals/${doc.rentalId}`)}
                            title="Ver locação"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {data.total > limit && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{data.total} documentos</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Anterior
                </Button>
                <Button variant="outline" size="sm" disabled={page * limit >= data.total} onClick={() => setPage(page + 1)}>
                  Próxima
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
