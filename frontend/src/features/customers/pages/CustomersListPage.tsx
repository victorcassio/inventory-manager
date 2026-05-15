import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { useCustomers } from '../hooks/useCustomers'
import { useAuthStore } from '@/stores/auth.store'
import { formatDocument } from '@/lib/formatters'
import { usePagination } from '@/hooks/usePagination'

export function CustomersListPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [search, setSearch] = useState('')
  const { page, limit, setPage } = usePagination()

  const canManage = user?.role === 'admin' || user?.role === 'attendant'

  const { data, isLoading, isError, refetch } = useCustomers({
    page,
    limit,
    name: search || undefined,
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Clientes</h2>
        {canManage && (
          <Button onClick={() => navigate('/customers/new')}>
            <Plus className="mr-2 h-4 w-4" />
            Novo Cliente
          </Button>
        )}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          className="pl-9"
        />
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {isError && (
        <ErrorState onRetry={() => refetch()} />
      )}

      {!isLoading && !isError && data && (
        <>
          {data.data.length === 0 ? (
            <EmptyState
              title="Nenhum cliente encontrado"
              description={search ? 'Tente buscar por outro nome.' : 'Cadastre o primeiro cliente.'}
              action={canManage ? { label: 'Novo Cliente', onClick: () => navigate('/customers/new') } : undefined}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Documento</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((customer) => (
                  <TableRow
                    key={customer.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/customers/${customer.id}`)}
                  >
                    <TableCell className="font-medium">{customer.name}</TableCell>
                    <TableCell>{formatDocument(customer.document)}</TableCell>
                    <TableCell>{customer.phone ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={customer.isActive ? 'default' : 'secondary'}>
                        {customer.isActive ? 'Ativo' : 'Inativo'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); navigate(`/customers/${customer.id}`) }}
                      >
                        Ver
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* Pagination */}
          {data.total > limit && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Total: {data.total} clientes
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page * limit >= data.total}
                  onClick={() => setPage(page + 1)}
                >
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
