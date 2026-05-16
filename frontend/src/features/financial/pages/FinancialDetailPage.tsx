import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft, Edit, Ban, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { ErrorState } from '@/components/feedback/ErrorState'
import { useFinancialTransaction } from '../hooks/useFinancialTransaction'
import { useVoidTransaction } from '../hooks/useVoidTransaction'
import { useAuthStore } from '@/stores/auth.store'
import { formatCurrency, formatDate } from '@/lib/formatters'
import {
  CATEGORY_LABELS, ORIGIN_LABELS, TYPE_LABELS,
  voidTransactionSchema, type VoidTransactionFormValues,
} from '../schemas/financialTransaction.schema'

export function FinancialDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { data: txn, isLoading, isError, refetch } = useFinancialTransaction(id!)
  const voidTransaction = useVoidTransaction()
  const [voidOpen, setVoidOpen] = useState(false)

  const voidForm = useForm<VoidTransactionFormValues>({
    resolver: zodResolver(voidTransactionSchema),
    defaultValues: { reason: '' },
  })

  const handleVoid = async (values: VoidTransactionFormValues) => {
    await voidTransaction.mutateAsync({ id: id!, reason: values.reason })
    setVoidOpen(false)
    voidForm.reset()
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full max-w-2xl" />
      </div>
    )
  }

  if (isError || !txn) return <ErrorState onRetry={() => refetch()} />

  const isManual   = txn.origin === 'manual'
  const isActive   = !txn.isVoided
  const canEdit    = isManual && isActive && (user?.role === 'admin' || user?.role === 'financial')
  const canVoid    = isManual && isActive && user?.role === 'admin'
  const isReadOnly = txn.origin !== 'manual'

  return (
    <div className="space-y-6">
      {/* Header + actions */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/financial/transactions')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-2xl font-bold flex-1">{txn.description}</h2>
        {isReadOnly && (
          <Badge variant="secondary">somente leitura</Badge>
        )}
        {canEdit && (
          <Button variant="outline" size="sm" onClick={() => navigate(`/financial/transactions/${id}/edit`)}>
            <Edit className="mr-2 h-4 w-4" />
            Editar
          </Button>
        )}
        {canVoid && (
          <Button
            variant="outline"
            size="sm"
            className="text-destructive border-destructive hover:bg-destructive hover:text-destructive-foreground"
            onClick={() => setVoidOpen(true)}
          >
            <Ban className="mr-2 h-4 w-4" />
            Anular
          </Button>
        )}
      </div>

      {/* Badges */}
      <div className="flex gap-2 flex-wrap">
        <Badge variant="outline">{CATEGORY_LABELS[txn.category] ?? txn.category}</Badge>
        <Badge variant="outline">{ORIGIN_LABELS[txn.origin] ?? txn.origin}</Badge>
        <Badge variant={txn.type === 'income' ? 'default' : 'destructive'}>
          {txn.type === 'income' ? '+' : '−'} {TYPE_LABELS[txn.type]}
        </Badge>
      </div>

      {/* Voided banner */}
      {txn.isVoided && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4">
          <p className="font-semibold text-destructive">Lançamento anulado</p>
          {txn.voidReason && (
            <p className="text-sm text-muted-foreground mt-1">
              Motivo: <span>{txn.voidReason}</span>
            </p>
          )}
          {txn.voidedAt && (
            <p className="text-xs text-muted-foreground mt-1">
              Anulado em {formatDate(txn.voidedAt)}
            </p>
          )}
        </div>
      )}

      {/* Amount card */}
      <Card className={txn.type === 'income' ? 'border-green-200 bg-green-50 dark:bg-green-950' : 'border-red-200 bg-red-50 dark:bg-red-950'}>
        <CardContent className="py-6 text-center">
          <p className="text-sm text-muted-foreground mb-1">Valor</p>
          <p className={`text-4xl font-bold ${txn.isVoided ? 'line-through text-muted-foreground' : txn.type === 'income' ? 'text-green-600' : 'text-red-600'}`}>
            {txn.type === 'income' ? '+' : '−'}{formatCurrency(txn.amount)}
          </p>
        </CardContent>
      </Card>

      {/* Fields */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 gap-y-4 gap-x-8 max-w-xl">
            <div>
              <p className="text-xs text-muted-foreground mb-1">DATA</p>
              <p className="font-medium">{formatDate(txn.date)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">ORIGEM</p>
              <p className="font-medium">{ORIGIN_LABELS[txn.origin] ?? txn.origin}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">CRIADO POR</p>
              <p className="font-medium">{txn.user?.name ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">CRIADO EM</p>
              <p className="font-medium">{formatDate(txn.createdAt)}</p>
            </div>
          </div>

          <Separator className="my-4" />

          <div className="mb-3">
            <p className="text-xs text-muted-foreground mb-1">LOCAÇÃO RELACIONADA</p>
            {txn.rental ? (
              <button
                className="text-primary font-mono text-sm hover:underline"
                onClick={() => navigate(`/rentals/${txn.rentalId}`)}
              >
                Contrato #{txn.rental.contractNumber} →
              </button>
            ) : (
              <p className="text-muted-foreground">—</p>
            )}
          </div>

          {txn.paymentId && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">PAGAMENTO RELACIONADO</p>
              <button
                className="text-primary text-sm hover:underline"
                onClick={() => navigate(`/rentals/${txn.rentalId}`)}
              >
                Ver pagamento na locação →
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Void dialog */}
      <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anular lançamento</DialogTitle>
          </DialogHeader>
          <Form {...voidForm}>
            <form onSubmit={voidForm.handleSubmit(handleVoid)} className="space-y-4">
              <FormField
                control={voidForm.control}
                name="reason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Motivo da anulação *</FormLabel>
                    <FormControl>
                      <Input placeholder="Descreva o motivo da anulação" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { setVoidOpen(false); voidForm.reset() }}
                >
                  Cancelar
                </Button>
                <Button type="submit" variant="destructive" disabled={voidTransaction.isPending}>
                  {voidTransaction.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Confirmar Anulação
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
