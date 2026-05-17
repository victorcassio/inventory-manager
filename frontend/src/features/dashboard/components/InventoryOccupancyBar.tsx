import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/feedback/EmptyState'
import type { DashboardInventory } from '@/types'

interface Props {
  data: DashboardInventory
}

function ProgressBar({ label, value, max, colorClass }: { label: string; value: number; max: number; colorClass: string }) {
  const pct = max === 0 ? 0 : Math.min((value / max) * 100, 100)
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="font-semibold">{value} ({pct.toFixed(1)}%)</span>
      </div>
      <div className="h-3 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full ${colorClass}`}
          style={{ width: `${pct}%`, transition: 'width 0.3s ease' }}
        />
      </div>
    </div>
  )
}

export function InventoryOccupancyBar({ data }: Props) {
  const hasData = data.totalItems > 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Ocupação do Estoque</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <EmptyState title="Sem itens" description="Nenhum item cadastrado no estoque." />
        ) : (
          <div className="space-y-4 pt-2">
            <ProgressBar
              label="Alugados"
              value={data.rentedItems}
              max={data.totalItems}
              colorClass="bg-blue-500"
            />
            <ProgressBar
              label="Disponíveis"
              value={data.availableItems}
              max={data.totalItems}
              colorClass="bg-green-500"
            />
            <ProgressBar
              label="Manutenção"
              value={data.maintenanceItems}
              max={data.totalItems}
              colorClass="bg-orange-400"
            />
            <p className="text-xs text-muted-foreground text-right">
              Total: {data.totalItems} itens · {data.occupancyRate.toFixed(1)}% ocupado
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
