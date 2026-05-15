import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { StatusBadge } from '@/components/feedback/StatusBadge'
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { ErrorState } from '@/components/feedback/ErrorState'
import { useRental, useCancelRental } from '../hooks/useRentals'
import { useAuthStore } from '@/stores/auth.store'
import { formatDate, formatCurrency, formatDocument } from '@/lib/formatters'
import type { ComputedRentalStatus } from '@/types'

export function RentalDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { data: rental, isLoading, isError, refetch } = useRental(id!)
  const cancelRental = useCancelRental()
  const [confirmCancel, setConfirmCancel] = useState(false)

  const isAdmin = user?.role === 'admin'

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-48 w-full max-w-4xl" />
      </div>
    )
  }

  if (isError || !rental) {
    return <ErrorState onRetry={() => refetch()} />
  }

  const handleCancel = async () => {
    await cancelRental.mutateAsync(rental.id)
    setConfirmCancel(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/rentals')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-2xl font-bold">Locação #{rental.contractNumber}</h2>
        <StatusBadge status={rental.computedStatus as ComputedRentalStatus} />
        {isAdmin && rental.status === 'active' && (
          <Button
            variant="destructive"
            size="sm"
            className="ml-auto"
            onClick={() => setConfirmCancel(true)}
          >
            <XCircle className="mr-2 h-4 w-4" />
            Cancelar Locação
          </Button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 max-w-5xl">
        {/* Contract info */}
        <Card>
          <CardHeader>
            <CardTitle>Informações do Contrato</CardTitle>
          </CardHeader>
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
                  <p className="text-sm text-muted-foreground">Dias em atraso</p>
                  <p className="font-medium text-destructive">{rental.daysOverdue}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Customer info */}
        <Card>
          <CardHeader>
            <CardTitle>Cliente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {rental.customer ? (
              <>
                <div>
                  <p className="text-sm text-muted-foreground">Nome</p>
                  <p className="font-medium">{rental.customer.name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Documento</p>
                  <p className="font-medium">{formatDocument(rental.customer.document)}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/customers/${rental.customer!.id}`)}
                >
                  Ver Cliente
                </Button>
              </>
            ) : (
              <p className="text-muted-foreground">—</p>
            )}
          </CardContent>
        </Card>

        {/* Items */}
        {rental.rentalItems && rental.rentalItems.length > 0 && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Itens Locados</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {rental.rentalItems.map((ri) => (
                  <div key={ri.id} className="flex items-center justify-between py-2">
                    <div>
                      <p className="font-medium">{ri.item?.name ?? ri.itemId}</p>
                      <p className="text-sm text-muted-foreground">
                        Código: {ri.item?.code ?? '—'} | Qtd: {ri.quantity}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium">{formatCurrency(ri.unitPrice)}/dia</p>
                      <p className="text-sm text-muted-foreground">
                        Devolvido: {ri.returnedQty}/{ri.quantity}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Financial summary */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Resumo Financeiro</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-w-sm space-y-2">
              {rental.subtotal && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>{formatCurrency(rental.subtotal)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Desconto</span>
                <span>- {formatCurrency(rental.discount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Caução</span>
                <span>{formatCurrency(rental.deposit)}</span>
              </div>
              {Number(rental.lateFee) > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Multa</span>
                  <span className="text-destructive">{formatCurrency(rental.lateFee)}</span>
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
              {rental.balanceAmount !== undefined && (
                <div className="flex justify-between font-semibold text-destructive">
                  <span>Saldo Devedor</span>
                  <span>{formatCurrency(rental.balanceAmount)}</span>
                </div>
              )}
            </div>

            <div className="mt-4 flex gap-3">
              <Button variant="outline" disabled>
                Registrar Devolução (em breve)
              </Button>
              <Button variant="outline" disabled>
                Registrar Pagamento (em breve)
              </Button>
            </div>
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
