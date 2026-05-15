import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Edit } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/feedback/ErrorState'
import { useCustomer } from '../hooks/useCustomers'
import { useAuthStore } from '@/stores/auth.store'
import { formatDocument } from '@/lib/formatters'

export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { data: customer, isLoading, isError, refetch } = useCustomer(id!)

  const canManage = user?.role === 'admin' || user?.role === 'attendant'

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full max-w-2xl" />
      </div>
    )
  }

  if (isError || !customer) {
    return <ErrorState onRetry={() => refetch()} />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/customers')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-2xl font-bold">{customer.name}</h2>
        <Badge variant={customer.isActive ? 'default' : 'secondary'}>
          {customer.isActive ? 'Ativo' : 'Inativo'}
        </Badge>
        {canManage && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => navigate(`/customers/${customer.id}/edit`)}
          >
            <Edit className="mr-2 h-4 w-4" />
            Editar
          </Button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 max-w-4xl">
        <Card>
          <CardHeader>
            <CardTitle>Dados Pessoais</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-sm text-muted-foreground">Nome</p>
              <p className="font-medium">{customer.name}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">
                {customer.documentType === 'cpf' ? 'CPF' : 'CNPJ'}
              </p>
              <p className="font-medium">{formatDocument(customer.document)}</p>
            </div>
            {customer.phone && (
              <div>
                <p className="text-sm text-muted-foreground">Telefone</p>
                <p className="font-medium">{customer.phone}</p>
              </div>
            )}
            {customer.email && (
              <div>
                <p className="text-sm text-muted-foreground">E-mail</p>
                <p className="font-medium">{customer.email}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {customer.notes && (
          <Card>
            <CardHeader>
              <CardTitle>Observações</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm">{customer.notes}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
