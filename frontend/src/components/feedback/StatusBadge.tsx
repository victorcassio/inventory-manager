import { Badge } from '@/components/ui/badge'
import type { ComputedRentalStatus } from '@/types'

const STATUS_CONFIG: Record<ComputedRentalStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  active:   { label: 'Ativo',      variant: 'default' },
  overdue:  { label: 'Vencido',    variant: 'destructive' },
  returned: { label: 'Devolvido',  variant: 'secondary' },
  canceled: { label: 'Cancelado',  variant: 'outline' },
}

export function StatusBadge({ status }: { status: ComputedRentalStatus }) {
  const config = STATUS_CONFIG[status] ?? { label: status, variant: 'outline' as const }
  return <Badge variant={config.variant}>{config.label}</Badge>
}
