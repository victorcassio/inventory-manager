import { useFormContext } from 'react-hook-form'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { formatCurrency } from '@/lib/formatters'
import type { PaymentFormValues } from '@/schemas/payment.schema'
import type { Rental } from '@/types'

const METHOD_LABELS: Record<string, string> = {
  cash: 'Dinheiro',
  pix: 'PIX',
  card: 'Cartão',
  transfer: 'Transferência',
}

interface Props {
  rental: Rental
  totalDamageFees: number
}

export function PaymentForm({ rental, totalDamageFees }: Props) {
  const form = useFormContext<PaymentFormValues>()
  const balance = (rental.balanceAmount ?? (
    Number(rental.total ?? 0) + Number(rental.lateFee ?? 0) + totalDamageFees - Number(rental.paidAmount ?? 0)
  ))

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Resumo do Saldo</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {rental.total && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total da Locação</span>
              <span>{formatCurrency(rental.total)}</span>
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
          <Separator />
          <div className="flex justify-between">
            <span className="text-muted-foreground">Valor Pago</span>
            <span>{formatCurrency(rental.paidAmount)}</span>
          </div>
          <div className="flex justify-between font-semibold text-lg">
            <span>Saldo em Aberto</span>
            <span className={balance > 0 ? 'text-destructive' : 'text-green-600'}>
              {formatCurrency(balance)}
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <FormField
          control={form.control}
          name="amount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Valor do Pagamento (R$)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={0.01}
                  max={balance}
                  step="0.01"
                  placeholder="0,00"
                  {...field}
                />
              </FormControl>
              <FormMessage />
              <p className="text-xs text-muted-foreground">Máximo: {formatCurrency(balance)}</p>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="method"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Forma de Pagamento</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {Object.entries(METHOD_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="paidAt"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Data do Pagamento</FormLabel>
              <FormControl>
                <DateInput {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="referenceCode"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Código de Referência</FormLabel>
              <FormControl>
                <Input placeholder="Ex.: código PIX, NSU, etc." {...field} />
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
    </div>
  )
}
