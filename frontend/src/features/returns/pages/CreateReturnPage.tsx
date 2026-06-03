import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/feedback/ErrorState'
import { StatusBadge } from '@/components/feedback/StatusBadge'
import { ReturnItemsTable } from '../components/ReturnItemsTable'
import { returnSchema, type ReturnFormValues } from '@/schemas/return.schema'
import { useRental } from '@/features/rentals/hooks/useRentals'
import { useCreateReturn } from '../hooks/useReturns'
import { formatCurrency, formatDate } from '@/lib/formatters'
import type { ComputedRentalStatus } from '@/types'

export function CreateReturnPage() {
  const { id: rentalId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: rental, isLoading, isError, refetch } = useRental(rentalId!)
  const createReturn = useCreateReturn(rentalId!)
  const [addedItemIds, setAddedItemIds] = useState<string[]>([])

  const form = useForm<ReturnFormValues>({
    resolver: zodResolver(returnSchema),
    defaultValues: { items: [], notes: '', returnedAt: '' },
  })

  const watchedItems = form.watch('items')

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-48 w-full max-w-4xl" /></div>
  if (isError || !rental) return <ErrorState onRetry={() => refetch()} />

  const pendingItems = rental.rentalItems?.filter(ri => ri.quantity - ri.returnedQty > 0) ?? []
  const isFullReturn = pendingItems.length > 0 && watchedItems.length > 0 &&
    watchedItems.every(wi => {
      const ri = rental.rentalItems?.find(r => r.id === wi.rentalItemId)
      return ri && Number(wi.quantity) >= ri.quantity - ri.returnedQty
    })

  const onSubmit = async (data: ReturnFormValues) => {
    const payload = {
      returnedAt: data.returnedAt || undefined,
      notes: data.notes || undefined,
      items: data.items.map(item => ({
        rentalItemId: item.rentalItemId,
        quantity: Number(item.quantity),
        condition: item.condition,
        damageFee: item.condition !== 'good' ? Number(item.damageFee) : undefined,
        notes: item.notes || undefined,
      })),
    }
    await createReturn.mutateAsync(payload)
    navigate(`/rentals/${rentalId}`)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/rentals/${rentalId}`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h2 className="text-2xl font-bold">Registrar Devolução</h2>
          <p className="text-sm text-muted-foreground">Locação #{rental.contractNumber}</p>
        </div>
        <StatusBadge status={rental.computedStatus as ComputedRentalStatus} />
      </div>

      <div className="grid gap-4 md:grid-cols-3 max-w-5xl">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>
              Itens a Devolver
              {watchedItems.length > 0 && (
                <span className={`ml-2 text-sm font-normal ${isFullReturn ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
                  {isFullReturn ? '(devolução total)' : '(devolução parcial)'}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FormProvider {...form}>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  <ReturnItemsTable
                    rentalItems={rental.rentalItems ?? []}
                    addedItemIds={addedItemIds}
                    onAddItem={id => setAddedItemIds(prev => [...prev, id])}
                  />

                  {form.formState.errors.items && typeof form.formState.errors.items === 'object' && 'message' in form.formState.errors.items && (
                    <p className="text-sm text-destructive">{String(form.formState.errors.items.message)}</p>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="returnedAt"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Data de devolução</FormLabel>
                          <FormControl>
                            <DateInput {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Observações</FormLabel>
                          <FormControl>
                            <Input placeholder="Opcional" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="flex gap-3">
                    <Button type="submit" disabled={createReturn.isPending || watchedItems.length === 0}>
                      {createReturn.isPending ? 'Registrando...' : 'Registrar Devolução'}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => navigate(`/rentals/${rentalId}`)}>
                      Cancelar
                    </Button>
                  </div>
                </form>
              </Form>
            </FormProvider>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Resumo da Locação</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Cliente</span>
              <span className="font-medium">{rental.customer?.name ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Início</span>
              <span>{formatDate(rental.startedAt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Devolução Prevista</span>
              <span>{formatDate(rental.expectedReturn)}</span>
            </div>
            {rental.daysOverdue > 0 && (
              <div className="flex justify-between text-destructive">
                <span>Atraso</span>
                <span>{rental.daysOverdue} dias</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total</span>
              <span className="font-medium">{formatCurrency(rental.total ?? '0')}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
