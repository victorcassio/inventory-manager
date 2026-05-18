import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft, Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { rentalSchema, type RentalFormValues } from '@/schemas/rental.schema'
import { useCreateRental } from '../hooks/useRentals'
import { useCustomers } from '@/features/customers/hooks/useCustomers'
import { useItems } from '@/features/inventory/hooks/useInventory'
import { formatCurrency } from '@/lib/formatters'

export function RentalNewPage() {
  const navigate = useNavigate()
  const createRental = useCreateRental()
  const [customerSearch, setCustomerSearch] = useState('')

  const { data: customersData } = useCustomers({ name: customerSearch || undefined, limit: 50 })
  const { data: itemsData } = useItems({ limit: 100 })

  const form = useForm<RentalFormValues>({
    resolver: zodResolver(rentalSchema),
    defaultValues: {
      customerId: '',
      startDate: new Date().toISOString().split('T')[0],
      expectedReturn: '',
      deposit: 0,
      discount: 0,
      notes: '',
      items: [],
    },
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'items',
  })

  const watchItems = form.watch('items')
  const watchStartDate = form.watch('startDate')
  const watchExpectedReturn = form.watch('expectedReturn')

  const calculateSubtotal = () => {
    if (!watchStartDate || !watchExpectedReturn) return 0
    const start = new Date(watchStartDate)
    const end = new Date(watchExpectedReturn)
    const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)))

    return watchItems.reduce((total, ri) => {
      const item = itemsData?.data.find(i => i.id === ri.itemId)
      if (!item) return total
      return total + (Number(item.dailyRate) * ri.quantity * days)
    }, 0)
  }

  const subtotal = calculateSubtotal()
  const deposit = form.watch('deposit') ?? 0
  const discount = form.watch('discount') ?? 0
  const total = subtotal - Number(discount) + Number(deposit)

  const onSubmit = async (values: RentalFormValues) => {
    await createRental.mutateAsync({
      customerId: values.customerId,
      startedAt: values.startDate,
      expectedReturn: values.expectedReturn,
      deposit: values.deposit ?? 0,
      discount: values.discount ?? 0,
      notes: values.notes,
      items: values.items,
    })
    navigate('/rentals')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/rentals')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-2xl font-bold">Nova Locação</h2>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Step 1: Customer */}
            <Card>
              <CardHeader>
                <CardTitle>1. Cliente</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Input
                    placeholder="Buscar cliente..."
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    className="mb-2"
                  />
                </div>
                <FormField
                  control={form.control}
                  name="customerId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cliente *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione um cliente" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {customersData?.data.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name} — {c.document}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Step 3: Dates */}
            <Card>
              <CardHeader>
                <CardTitle>2. Datas e Valores</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="startDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Início *</FormLabel>
                        <FormControl>
                          <DateInput {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="expectedReturn"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Devolução *</FormLabel>
                        <FormControl>
                          <DateInput {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="deposit"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Caução (R$)</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" min="0" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="discount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Desconto (R$)</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" min="0" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Observações</FormLabel>
                      <FormControl>
                        <Input placeholder="Observações adicionais" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>
          </div>

          {/* Step 2: Items */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>3. Itens</CardTitle>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ itemId: '', quantity: 1 })}
              >
                <Plus className="mr-2 h-4 w-4" />
                Adicionar Item
              </Button>
            </CardHeader>
            <CardContent>
              {fields.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Nenhum item adicionado. Clique em "Adicionar Item".
                </p>
              )}
              {form.formState.errors.items?.root && (
                <p className="text-sm font-medium text-destructive mb-2">
                  {form.formState.errors.items.root.message}
                </p>
              )}
              {form.formState.errors.items?.message && (
                <p className="text-sm font-medium text-destructive mb-2">
                  {form.formState.errors.items.message}
                </p>
              )}
              <div className="space-y-3">
                {fields.map((field, index) => {
                  const selectedItem = itemsData?.data.find(i => i.id === watchItems[index]?.itemId)
                  return (
                    <div key={field.id} className="flex items-end gap-3">
                      <FormField
                        control={form.control}
                        name={`items.${index}.itemId`}
                        render={({ field: f }) => (
                          <FormItem className="flex-1">
                            {index === 0 && <FormLabel>Item</FormLabel>}
                            <Select onValueChange={f.onChange} value={f.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Selecione um item" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {itemsData?.data.filter(i => i.availableQty > 0).map((item) => (
                                  <SelectItem key={item.id} value={item.id}>
                                    {item.name} ({item.code}) — {formatCurrency(item.dailyRate)}/dia — {item.availableQty} disp.
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`items.${index}.quantity`}
                        render={({ field: f }) => (
                          <FormItem className="w-24">
                            {index === 0 && <FormLabel>Qtd.</FormLabel>}
                            <FormControl>
                              <Input
                                type="number"
                                min="1"
                                max={selectedItem?.availableQty}
                                {...f}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="mb-0"
                        onClick={() => remove(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {/* Preview */}
          {fields.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>4. Resumo</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal estimado</span>
                  <span>{formatCurrency(subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Desconto</span>
                  <span>- {formatCurrency(discount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Caução</span>
                  <span>+ {formatCurrency(deposit)}</span>
                </div>
                <Separator />
                <div className="flex justify-between font-semibold">
                  <span>Total estimado</span>
                  <span>{formatCurrency(total)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  * Valores estimados baseados nas datas e diárias informadas.
                </p>
              </CardContent>
            </Card>
          )}

          <div className="flex gap-3">
            <Button type="submit" disabled={createRental.isPending}>
              {createRental.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Criar Locação
            </Button>
            <Button type="button" variant="outline" onClick={() => navigate('/rentals')}>
              Cancelar
            </Button>
          </div>
        </form>
      </Form>
    </div>
  )
}
