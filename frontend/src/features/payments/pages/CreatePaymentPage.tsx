import { useNavigate, useParams } from 'react-router-dom'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Form } from '@/components/ui/form'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/feedback/ErrorState'
import { StatusBadge } from '@/components/feedback/StatusBadge'
import { PaymentForm } from '../components/PaymentForm'
import { paymentSchema, type PaymentFormValues } from '@/schemas/payment.schema'
import { useRental } from '@/features/rentals/hooks/useRentals'
import { useReturnsByRental } from '@/features/returns/hooks/useReturns'
import { useCreatePayment } from '../hooks/usePayments'
import { formatDocument } from '@/lib/formatters'
import type { ComputedRentalStatus } from '@/types'

export function CreatePaymentPage() {
  const { id: rentalId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: rental, isLoading, isError, refetch } = useRental(rentalId!)
  const { data: returns = [] } = useReturnsByRental(rentalId!)
  const createPayment = useCreatePayment(rentalId!)

  const form = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentSchema),
    defaultValues: { amount: 0, method: undefined, referenceCode: '', notes: '' },
  })

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-48 w-full max-w-4xl" /></div>
  if (isError || !rental) return <ErrorState onRetry={() => refetch()} />

  const totalDamageFees = returns
    .flatMap(r => r.returnItems ?? [])
    .reduce((sum, ri) => sum + Number(ri.damageFee ?? 0), 0)

  const balance = rental.balanceAmount ?? (
    Number(rental.total ?? 0) + Number(rental.lateFee ?? 0) + totalDamageFees - Number(rental.paidAmount ?? 0)
  )

  const isCanceled = rental.status === 'canceled'
  const nothingToPay = balance <= 0

  const onSubmit = async (data: PaymentFormValues) => {
    const payload = {
      amount: Number(data.amount),
      method: data.method,
      paidAt: data.paidAt || undefined,
      referenceCode: data.referenceCode || undefined,
      notes: data.notes || undefined,
    }
    await createPayment.mutateAsync(payload)
    navigate(`/rentals/${rentalId}`)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/rentals/${rentalId}`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h2 className="text-2xl font-bold">Registrar Pagamento</h2>
          <p className="text-sm text-muted-foreground">
            Locação #{rental.contractNumber} | {rental.customer?.name ?? '—'}{rental.customer?.document ? ` | ${formatDocument(rental.customer.document)}` : ''}
          </p>
        </div>
        <StatusBadge status={rental.computedStatus as ComputedRentalStatus} />
      </div>

      {isCanceled && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive max-w-2xl">
          <AlertCircle className="h-5 w-5" />
          <p>Não é possível registrar pagamento para uma locação cancelada.</p>
        </div>
      )}

      {nothingToPay && !isCanceled && (
        <div className="flex items-center gap-2 rounded-lg border border-green-500/50 bg-green-50 p-4 text-green-700 max-w-2xl">
          <AlertCircle className="h-5 w-5" />
          <p>Esta locação já está quitada.</p>
        </div>
      )}

      {!isCanceled && !nothingToPay && (
        <div className="max-w-2xl">
          <FormProvider {...form}>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <Card>
                  <CardHeader><CardTitle>Dados do Pagamento</CardTitle></CardHeader>
                  <CardContent>
                    <PaymentForm rental={rental} totalDamageFees={totalDamageFees} />
                  </CardContent>
                </Card>
                <div className="flex gap-3">
                  <Button type="submit" disabled={createPayment.isPending}>
                    {createPayment.isPending ? 'Registrando...' : 'Confirmar Pagamento'}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => navigate(`/rentals/${rentalId}`)}>
                    Cancelar
                  </Button>
                </div>
              </form>
            </Form>
          </FormProvider>
        </div>
      )}

      {(isCanceled || nothingToPay) && (
        <Button variant="outline" onClick={() => navigate(`/rentals/${rentalId}`)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar
        </Button>
      )}
    </div>
  )
}
