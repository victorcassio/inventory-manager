import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { useItems, useCategories } from '../hooks/useInventory'
import { useAuthStore } from '@/stores/auth.store'
import { formatCurrency } from '@/lib/formatters'
import { usePagination } from '@/hooks/usePagination'

const CONDITION_LABELS: Record<string, string> = {
  new: 'Novo',
  good: 'Bom',
  fair: 'Regular',
  maintenance: 'Manutenção',
}

export function ItemsListPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [categoryId, setCategoryId] = useState<string>('')
  const { page, limit, setPage } = usePagination()

  const canManage = user?.role === 'admin'

  const { data: categories } = useCategories()
  const { data, isLoading, isError, refetch } = useItems({
    page,
    limit,
    categoryId: categoryId || undefined,
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Estoque</h2>
        {canManage && (
          <Button onClick={() => navigate('/inventory/items/new')}>
            <Plus className="mr-2 h-4 w-4" />
            Novo Item
          </Button>
        )}
      </div>

      {/* Category filter */}
      <div className="max-w-xs">
        <Select
          value={categoryId}
          onValueChange={(v) => { setCategoryId(v === 'all' ? '' : v); setPage(1) }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Filtrar por categoria" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as categorias</SelectItem>
            {categories?.map((cat) => (
              <SelectItem key={cat.id} value={cat.id}>
                {cat.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {isError && <ErrorState onRetry={() => refetch()} />}

      {!isLoading && !isError && data && (
        <>
          {data.data.length === 0 ? (
            <EmptyState
              title="Nenhum item encontrado"
              description="Cadastre o primeiro item no estoque."
              action={canManage ? { label: 'Novo Item', onClick: () => navigate('/inventory/items/new') } : undefined}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Valor Diário</TableHead>
                  <TableHead>Disponível</TableHead>
                  <TableHead>Condição</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((item) => (
                  <TableRow
                    key={item.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/inventory/items/${item.id}`)}
                  >
                    <TableCell className="font-mono text-xs">{item.code}</TableCell>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>{item.category?.name ?? '—'}</TableCell>
                    <TableCell>{formatCurrency(item.dailyRate)}</TableCell>
                    <TableCell>
                      <Badge variant={item.availableQty > 0 ? 'default' : 'destructive'}>
                        {item.availableQty}/{item.totalQty}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {CONDITION_LABELS[item.condition] ?? item.condition}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {data.total > limit && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Total: {data.total} itens</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Anterior
                </Button>
                <Button variant="outline" size="sm" disabled={page * limit >= data.total} onClick={() => setPage(page + 1)}>
                  Próxima
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
