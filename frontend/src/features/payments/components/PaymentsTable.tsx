// src/features/payments/components/PaymentsTable.tsx
import type { Payment } from '@/types'
import { formatCurrency, formatDate } from '@/lib/formatters'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

const METHOD_LABELS: Record<string, string> = {
  cash: 'Dinheiro', pix: 'PIX', card: 'Cartão', transfer: 'Transferência',
}

interface Props { payments: Payment[] }

export function PaymentsTable({ payments }: Props) {
  if (payments.length === 0)
    return <p className="text-sm text-muted-foreground">Nenhum pagamento registrado.</p>

  return (
    <>
      {/* Desktop */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Método</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead>Ref.</TableHead>
              <TableHead>Observação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.map(p => (
              <TableRow key={p.id}>
                <TableCell>{formatDate(p.paidAt)}</TableCell>
                <TableCell>{METHOD_LABELS[p.method] ?? p.method}</TableCell>
                <TableCell className="font-medium">{formatCurrency(p.amount)}</TableCell>
                <TableCell>{p.referenceCode ?? '—'}</TableCell>
                <TableCell>{p.notes ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile */}
      <div className="md:hidden divide-y rounded-md border">
        {payments.map(p => (
          <div key={p.id} className="flex items-center gap-3 p-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{METHOD_LABELS[p.method] ?? p.method}</p>
              <p className="text-xs text-muted-foreground">{formatDate(p.paidAt)}</p>
            </div>
            <span className="text-sm font-semibold shrink-0">{formatCurrency(p.amount)}</span>
          </div>
        ))}
      </div>
    </>
  )
}
