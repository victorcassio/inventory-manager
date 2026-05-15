import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, XCircle, RotateCcw, CreditCard } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { StatusBadge } from '@/components/feedback/StatusBadge'
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { ErrorState } from '@/components/feedback/ErrorState'
import { PaymentsTable } from '@/features/payments/components/PaymentsTable'
import { useRental, useCancelRental } from '../hooks/useRentals'
import { useReturnsByRental } from '@/features/returns/hooks/useReturns'
import { usePaymentsByRental } from '@/features/payments/hooks/usePayments'
import { useAuthStore } from '@/stores/auth.store'
import { formatDate, formatCurrency, formatDocument } from '@/lib/formatters'
import type { ComputedRentalStatus } from '@/types'

const CONDITION_LABEL: Record<string, string> = {
  good: 'Bom estado',
  damaged: 'Danificado',
  lost: 'Extraviado',
}

export function RentalDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { data: rental, isLoading, isError, refetch } = useRental(id!)
  const { data: returns = [] } = useReturnsByRental(id!)
  const { data: payments = [] } = usePaymentsByRental(id!)
  const cancelRental = useCancelRental()
  const [confirmCancel, setConfirmCancel] = useState(false)

  const role = user?.role

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-48 w-full max-w-5xl" />
      </div>
    )
  }

  if (isError || !rental) {
    return <ErrorState onRetry={() => refetch()} />
  }

  const totalDamageFees = returns
    .flatMap(r => r.returnItems ?? [])
    .reduce((sum, ri) => sum + Number(ri.damageFee ?? 0), 0)

  const balance = rental.balanceAmount ?? (
    Number(rental.total ?? 0) + Number(rental.lateFee ?? 0) + totalDamageFees - Number(rental.paidAmount ?? 0)
  )

  const canRegisterReturn = (role === 'admin' || role === 'attendant') && rental.status === 'active'
  const canRegisterPayment = (role === 'admin' || role === 'financial') && rental.status !== 'canceled' && balance > 0
  const canCancel = role === 'admin' && rental.status === 'active'

  const handleCancel = async () => {
    await cancelRental.mutateAsync(rental.id)
    setConfirmCancel(false)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/rentals')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-2xl font-bold">Locação #{rental.contractNumber}</h2>
        <StatusBadge status={rental.computedStatus as ComputedRentalStatus} />
        <div className="ml-auto flex gap-2">
          {canRegisterReturn && (
            <Button size="sm" variant="outline" onClick={() => navigate(`/rentals/${id}/returns/new`)}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Registrar Devolução
            </Button>
          )}
          {canRegisterPayment && (
            <Button size="sm" onClick={() => navigate(`/rentals/${id}/payments/new`)}>
              <CreditCard className="mr-2 h-4 w-4" />
              Registrar Pagamento
            </Button>
          )}
          {canCancel && (
            <Button variant="destructive" size="sm" onClick={() => setConfirmCancel(true)}>
              <XCircle className="mr-2 h-4 w-4" />
              Cancelar Locação
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 max-w-5xl">
        {/* Contract info */}
        <Card>
          <CardHeader><CardTitle>Informações do Contrato</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Início</p>
                <p className="font-medium">{formatDate(rental.startedAt)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Devolução Prevista</p>
                <p className="font-medium">{formatDate(rental.expectedReturn)}</p>
              </div>
              {rental.returnedAt && (
                <div>
                  <p className="text-sm text-muted-foreground">Devolvido em</p>
                  <p className="font-medium">{formatDate(rental.returnedAt)}</p>
                </div>
              )}
              {rental.daysOverdue > 0 && (
                <div>
                  <p className="text-sm text-muted-foreground">Atraso</p>
                  <p className="font-medium text-destructive">{rental.daysOverdue} dias</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Customer */}
        <Card>
          <CardHeader><CardTitle>Cliente</CardTitle></CardHeader>
          <CardContent>
            {rental.customer ? (
              <div className="space-y-2">
                <p className="font-medium">{rental.customer.name}</p>
                <p className="text-sm text-muted-foreground">{formatDocument(rental.customer.document)}</p>
                <Button variant="outline" size="sm" onClick={() => navigate(`/customers/${rental.customer!.id}`)}>
                  Ver Cliente
                </Button>
              </div>
            ) : <p className="text-muted-foreground">—</p>}
          </CardContent>
        </Card>

        {/* Rental items */}
        {rental.rentalItems && rental.rentalItems.length > 0 && (
          <Card className="md:col-span-2">
            <CardHeader><CardTitle>Itens Locados</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {rental.rentalItems.map(ri => {
                  const pending = ri.quantity - ri.returnedQty
                  return (
                    <div key={ri.id} className="flex items-center justify-between py-2 border-b last:border-0">
                      <div>
                        <p className="font-medium">{ri.item?.name ?? ri.itemId}</p>
                        <p className="text-sm text-muted-foreground">
                          Código: {ri.item?.code ?? '—'}
                        </p>
                      </div>
                      <div className="text-right text-sm">
                        <p>{formatCurrency(ri.unitPrice)}/dia</p>
                        <p className="text-muted-foreground">
                          Total: {ri.quantity} | Dev: {ri.returnedQty} |{' '}
                          <span className={pending > 0 ? 'text-amber-600 font-medium' : 'text-green-600'}>
                            Pendente: {pending}
                          </span>
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Financial summary */}
        <Card>
          <CardHeader><CardTitle>Resumo Financeiro</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              {rental.subtotal && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>{formatCurrency(rental.subtotal)}</span>
                </div>
              )}
              {Number(rental.discount) > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Desconto</span>
                  <span>- {formatCurrency(rental.discount)}</span>
                </div>
              )}
              {Number(rental.extraCosts) > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Custos Extras</span>
                  <span>{formatCurrency(rental.extraCosts)}</span>
                </div>
              )}
              {Number(rental.deposit) > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Caução</span>
                  <span>{formatCurrency(rental.deposit)}</span>
                </div>
              )}
              {Number(rental.lateFee) > 0 && (
                <div className="flex justify-between text-amber-600">
                  <span>Multa por Atraso</span>
                  <span>{formatCurrency(rental.lateFee)}</span>
                </div>
              )}
              {totalDamageFees > 0 && (
                <div className="flex justify-between text-amber-600">
                  <span>Taxas de Dano</span>
                  <span>{formatCurrency(totalDamageFees)}</span>
                </div>
              )}
              {rental.total && (
                <>
                  <Separator />
                  <div className="flex justify-between font-semibold">
                    <span>Total</span>
                    <span>{formatCurrency(rental.total)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Valor Pago</span>
                <span>{formatCurrency(rental.paidAmount)}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Saldo em Aberto</span>
                <span className={balance > 0 ? 'text-destructive' : 'text-green-600'}>
                  {formatCurrency(balance)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Returns */}
        <Card>
          <CardHeader><CardTitle>Devoluções ({returns.length})</CardTitle></CardHeader>
          <CardContent>
            {returns.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma devolução registrada.</p>
            ) : (
              <div className="space-y-4">
                {returns.map(ret => (
                  <div key={ret.id} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{formatDate(ret.returnedAt)}</span>
                      <Badge variant={ret.isPartial ? 'secondary' : 'default'}>
                        {ret.isPartial ? 'Parcial' : 'Total'}
                      </Badge>
                    </div>
                    {(ret.lateDays > 0 || Number(ret.lateFee) > 0) && (
                      <p className="text-sm text-amber-600">
                        Atraso: {ret.lateDays} dias | Multa: {formatCurrency(ret.lateFee)}
                      </p>
                    )}
                    {ret.returnItems && ret.returnItems.length > 0 && (
                      <div className="space-y-1">
                        {ret.returnItems.map(ri => (
                          <div key={ri.id} className="text-xs text-muted-foreground flex justify-between">
                            <span>{ri.rentalItem?.item?.name ?? '—'} × {ri.quantity}</span>
                            <span className="flex gap-2">
                              <span>{CONDITION_LABEL[ri.condition] ?? ri.condition}</span>
                              {Number(ri.damageFee) > 0 && (
                                <span className="text-amber-600">{formatCurrency(ri.damageFee)}</span>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Payments */}
        <Card className="md:col-span-2">
          <CardHeader><CardTitle>Pagamentos ({payments.length})</CardTitle></CardHeader>
          <CardContent>
            <PaymentsTable payments={payments} />
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        title="Cancelar Locação"
        description={`Tem certeza que deseja cancelar a locação #${rental.contractNumber}? Esta ação não pode ser desfeita.`}
        confirmLabel="Sim, cancelar"
        onConfirm={handleCancel}
        onCancel={() => setConfirmCancel(false)}
        destructive
      />
    </div>
  )
}
