import { useFieldArray, useFormContext } from 'react-hook-form'
import type { ReturnFormValues } from '@/schemas/return.schema'
import type { RentalItem } from '@/types'
import { FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Trash2 } from 'lucide-react'

interface Props {
  rentalItems: RentalItem[]
  addedItemIds: string[]
  onAddItem: (rentalItemId: string) => void
}

export function ReturnItemsTable({ rentalItems, addedItemIds, onAddItem }: Props) {
  const form = useFormContext<ReturnFormValues>()
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'items' })

  const pendingItems = rentalItems.filter(
    ri => ri.quantity - ri.returnedQty > 0 && !addedItemIds.includes(ri.id),
  )

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {fields.map((field, index) => {
          const ri = rentalItems.find(r => r.id === field.rentalItemId)
          const pending = ri ? ri.quantity - ri.returnedQty : 0
          const condition = form.watch(`items.${index}.condition`)

          return (
            <div key={field.id} className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{ri?.item?.name ?? field.rentalItemId}</p>
                  <p className="text-sm text-muted-foreground">
                    Alugado: {ri?.quantity ?? '?'} | Devolvido: {ri?.returnedQty ?? 0} | Pendente: {pending}
                  </p>
                </div>
                <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name={`items.${index}.quantity`}
                  render={({ field }) => (
                    <FormItem>
                      <label className="text-sm font-medium">Qtd. a devolver</label>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          max={pending}
                          {...field}
                          onChange={e => {
                            const v = Math.min(Number(e.target.value), pending)
                            field.onChange(v)
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name={`items.${index}.condition`}
                  render={({ field }) => (
                    <FormItem>
                      <label className="text-sm font-medium">Condição</label>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="good">Bom estado</SelectItem>
                          <SelectItem value="damaged">Danificado</SelectItem>
                          <SelectItem value="lost">Extraviado</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {condition && condition !== 'good' && (
                  <FormField
                    control={form.control}
                    name={`items.${index}.damageFee`}
                    render={({ field }) => (
                      <FormItem>
                        <label className="text-sm font-medium">Taxa de dano (R$)</label>
                        <FormControl>
                          <Input type="number" min={0.01} step="0.01" placeholder="0,00" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <FormField
                  control={form.control}
                  name={`items.${index}.notes`}
                  render={({ field }) => (
                    <FormItem className={condition !== 'good' ? '' : 'col-span-2'}>
                      <label className="text-sm font-medium">Observação</label>
                      <FormControl>
                        <Input placeholder="Opcional" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
          )
        })}
      </div>

      {pendingItems.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-2">Adicionar item à devolução:</p>
          <div className="flex flex-wrap gap-2">
            {pendingItems.map(ri => (
              <Button
                key={ri.id}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  onAddItem(ri.id)
                  append({ rentalItemId: ri.id, quantity: ri.quantity - ri.returnedQty, condition: 'good', damageFee: 0 })
                }}
              >
                {ri.item?.name ?? ri.id} (pendente: {ri.quantity - ri.returnedQty})
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
