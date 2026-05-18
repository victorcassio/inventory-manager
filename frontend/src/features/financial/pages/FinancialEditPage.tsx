import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { format } from 'date-fns'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/feedback/ErrorState'
import { cn } from '@/lib/utils'
import { useFinancialTransaction } from '../hooks/useFinancialTransaction'
import { useUpdateTransaction } from '../hooks/useUpdateTransaction'
import {
  updateTransactionSchema,
  type UpdateTransactionFormValues,
  CATEGORY_LABELS,
} from '../schemas/financialTransaction.schema'

export function FinancialEditPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: txn, isLoading, isError, refetch } = useFinancialTransaction(id!)
  const updateTransaction = useUpdateTransaction()

  const form = useForm<UpdateTransactionFormValues>({
    resolver: zodResolver(updateTransactionSchema),
    defaultValues: {
      type: 'income',
      category: 'rental_income',
      amount: 0,
      transactionDate: format(new Date(), 'yyyy-MM-dd'),
      description: '',
      rentalId: undefined,
    },
  })

  useEffect(() => {
    if (!txn) return
    form.reset({
      type:            txn.type,
      category:        txn.category,
      amount:          Number(txn.amount),
      transactionDate: txn.date,
      description:     txn.description,
      rentalId:        txn.rentalId ?? undefined,
    })
  }, [txn, form])

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-96 w-full max-w-2xl" />
      </div>
    )
  }

  if (isError || !txn) return <ErrorState onRetry={() => refetch()} />

  // Guard: non-manual origin
  if (txn.origin !== 'manual') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/financial/transactions/${id}`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-2xl font-bold">Editar Lançamento</h2>
        </div>
        <Card className="max-w-2xl">
          <CardContent className="py-8 text-center text-muted-foreground">
            <p>Este lançamento foi gerado automaticamente e não pode ser editado diretamente.</p>
            <Button className="mt-4" variant="outline" onClick={() => navigate(`/financial/transactions/${id}`)}>
              Voltar ao Detalhe
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Guard: voided transaction
  if (txn.isVoided) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/financial/transactions/${id}`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-2xl font-bold">Editar Lançamento</h2>
        </div>
        <Card className="max-w-2xl">
          <CardContent className="py-8 text-center text-muted-foreground">
            <p>Este lançamento está anulado e não pode ser editado.</p>
            <Button className="mt-4" variant="outline" onClick={() => navigate(`/financial/transactions/${id}`)}>
              Voltar ao Detalhe
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const onSubmit = async (values: UpdateTransactionFormValues) => {
    await updateTransaction.mutateAsync({ id: id!, data: values })
    navigate(`/financial/transactions/${id}`)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/financial/transactions/${id}`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-2xl font-bold">Editar Lançamento</h2>
      </div>

      <Card className="max-w-2xl">
        <CardHeader><CardTitle>Dados do Lançamento</CardTitle></CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              {/* Type selector */}
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo *</FormLabel>
                    <div className="grid grid-cols-2 gap-3">
                      {(['income', 'expense'] as const).map(t => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => field.onChange(t)}
                          className={cn(
                            'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                            field.value === t
                              ? t === 'income'
                                ? 'border-green-500 bg-green-50 dark:bg-green-950'
                                : 'border-red-500 bg-red-50 dark:bg-red-950'
                              : 'border-border hover:bg-muted',
                          )}
                        >
                          <span className={cn(
                            'h-3 w-3 rounded-full border-2',
                            field.value === t
                              ? t === 'income' ? 'bg-green-500 border-green-500' : 'bg-red-500 border-red-500'
                              : 'border-muted-foreground',
                          )} />
                          <div>
                            <p className={cn('font-semibold text-sm', field.value === t
                              ? t === 'income' ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'
                              : 'text-muted-foreground')}>
                              {t === 'income' ? 'Entrada' : 'Saída'}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Category */}
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Categoria *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                          <SelectItem key={k} value={k}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Amount + Date */}
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Valor (R$) *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="0.01"
                          step="0.01"
                          {...field}
                          onChange={e => field.onChange(e.target.valueAsNumber)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="transactionDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Data do lançamento *</FormLabel>
                      <FormControl><DateInput {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Description */}
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descrição *</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Origin read-only */}
              <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                Origem: <strong>manual</strong> — não editável
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 border-t pt-4">
                <Button type="button" variant="outline" onClick={() => navigate(`/financial/transactions/${id}`)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={updateTransaction.isPending}>
                  {updateTransaction.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Salvar Alterações
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}
