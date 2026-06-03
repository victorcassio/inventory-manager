import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Edit } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/feedback/ErrorState'
import { useItem } from '../hooks/useInventory'
import { useAuthStore } from '@/stores/auth.store'
import { formatCurrency } from '@/lib/formatters'

const CONDITION_LABELS: Record<string, string> = {
  new: 'Novo',
  good: 'Bom',
  fair: 'Regular',
  maintenance: 'Manutenção',
}

export function ItemDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { data: item, isLoading, isError, refetch } = useItem(id!)

  const canManage = user?.role === 'admin'

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full max-w-2xl" />
      </div>
    )
  }

  if (isError || !item) {
    return <ErrorState onRetry={() => refetch()} />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/inventory/items')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-2xl font-bold">{item.name}</h2>
        <Badge variant="outline">{item.code}</Badge>
        {canManage && (
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => navigate(`/inventory/items/${item.id}/edit`)}>
            <Edit className="mr-2 h-4 w-4" />
            Editar
          </Button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 max-w-4xl">
        <Card>
          <CardHeader>
            <CardTitle>Informações do Item</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-sm text-muted-foreground">Categoria</p>
              <p className="font-medium">{item.category?.name ?? '—'}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Valor Diário</p>
              <p className="font-medium">{formatCurrency(item.dailyRate)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Condição</p>
              <Badge variant="outline">{CONDITION_LABELS[item.condition] ?? item.condition}</Badge>
            </div>
            {item.description && (
              <div>
                <p className="text-sm text-muted-foreground">Descrição</p>
                <p className="text-sm">{item.description}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Estoque</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-2xl font-bold">{item.totalQty}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Disponível</p>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">{item.availableQty}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Alugado</p>
                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{item.rentedQty}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Manutenção</p>
                <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">{item.maintenanceQty}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
