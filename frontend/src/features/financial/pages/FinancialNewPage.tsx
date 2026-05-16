import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { format } from 'date-fns'
import { ArrowLeft, Loader2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useCreateTransaction } from '../hooks/useCreateTransaction'
import {
  createTransactionSchema,
  type CreateTransactionFormValues,
  CATEGORY_LABELS,
} from '../schemas/financialTransaction.schema'
import { rentalsApi } from '@/lib/api/rentals.api'
import type { Rental } from '@/types'

export function FinancialNewPage() {
  const navigate = useNavigate()
  const createTransaction = useCreateTransaction()

  const [rentalSearch,   setRentalSearch]   = useState('')
  const [rentalResults,  setRentalResults]  = useState<Pick<Rental, 'id' | 'contractNumber'>[]>([])
  const [selectedRental, setSelectedRental] = useState<Pick<Rental, 'id' | 'contractNumber'> | null>(null)
  const [showResults,    setShowResults]    = useState(false)

  const form = useForm<CreateTransactionFormValues>({
    resolver: zodResolver(createTransactionSchema),
    defaultValues: {
      type: 'income',
      category: 'rental_income',
      amount: 0,
      transactionDate: format(new Date(), 'yyyy-MM-dd'),
      description: '',
      rentalId: undefined,
    },
  })

  const handleRentalSearch = async (value: string) => {
    setRentalSearch(value)
    setSelectedRental(null)
    form.setValue('rentalId', undefined)
    if (value.length < 2) { setRentalResults([]); setShowResults(false); return }
    try {
      const result = await rentalsApi.list({ contractNumber: value, limit: 5 })
      setRentalResults(result.data.map(r => ({ id: r.id, contractNumber: r.contractNumber })))
      setShowResults(true)
    } catch {
      setRentalResults([])
    }
  }

  const handleRentalSelect = (rental: Pick<Rental, 'id' | 'contractNumber'>) => {
    setSelectedRental(rental)
    setRentalSearch(rental.contractNumber)
    form.setValue('rentalId', rental.id)
    setShowResults(false)
  }

  const onSubmit = async (values: CreateTransactionFormValues) => {
    const result = await createTransaction.mutateAsync(values)
    navigate(`/financial/transactions/${(result as { id: string }).id}`)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/financial/transactions')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-2xl font-bold">Novo Lançamento</h2>
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
                          <span
                            className={cn(
                              'h-3 w-3 rounded-full border-2',
                              field.value === t
                                ? t === 'income' ? 'bg-green-500 border-green-500' : 'bg-red-500 border-red-500'
                                : 'border-muted-foreground',
                            )}
                          />
                          <div>
                            <p className={cn('font-semibold text-sm', field.value === t
                              ? t === 'income' ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'
                              : 'text-muted-foreground')}>
                              {t === 'income' ? 'Entrada' : 'Saída'}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {t === 'income' ? 'Receita / income' : 'Despesa / expense'}
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
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
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
                          placeholder="0,00"
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
                      <FormControl><Input type="date" {...field} /></FormControl>
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
                    <FormLabel htmlFor="description">Descrição *</FormLabel>
                    <FormControl>
                      <Input id="description" placeholder="Ex: Manutenção preventiva andaimes lote B" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Rental autocomplete */}
              <div className="space-y-1">
                <label className="text-sm font-medium leading-none">
                  Locação relacionada{' '}
                  <span className="text-muted-foreground font-normal">(opcional)</span>
                </label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder="Buscar por contrato ou cliente..."
                    value={rentalSearch}
                    onChange={e => handleRentalSearch(e.target.value)}
                    onBlur={() => setTimeout(() => setShowResults(false), 150)}
                  />
                  {showResults && rentalResults.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full rounded-md border bg-background shadow-md">
                      {rentalResults.map(r => (
                        <button
                          key={r.id}
                          type="button"
                          className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                          onMouseDown={() => handleRentalSelect(r)}
                        >
                          Contrato #{r.contractNumber}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Use apenas quando este lançamento estiver ligado a uma locação existente.
                </p>
                {selectedRental && (
                  <p className="text-xs text-green-600">
                    ✓ Vinculado ao contrato #{selectedRental.contractNumber}
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 border-t pt-4">
                <Button type="button" variant="outline" onClick={() => navigate('/financial/transactions')}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={createTransaction.isPending}>
                  {createTransaction.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Salvar Lançamento
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}
