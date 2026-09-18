import { useRef } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingSpinner } from '@/components/feedback/LoadingSpinner'
import { ErrorState } from '@/components/feedback/ErrorState'
import { EmptyState } from '@/components/feedback/EmptyState'
import { UserForm } from '../components/UserForm'
import { useUpdateUser, useUser } from '../hooks/useUsers'
import type { UpdateUserFormValues } from '@/schemas/user.schema'

export function UserEditPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { data: user, isLoading, isError, refetch } = useUser(id)
  const updateUser = useUpdateUser()
  const inFlight = useRef<Promise<unknown> | null>(null)

  const handleSubmit = (values: UpdateUserFormValues) => {
    if (inFlight.current) return
    const request = updateUser
      .mutateAsync({ id, data: values })
      .then(() => {
        navigate('/users')
      })
      .catch(() => {
        // onError already toasted; stay on the form to allow a retry.
      })
    inFlight.current = request
    void request.finally(() => {
      if (inFlight.current === request) inFlight.current = null
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/users" aria-label="Voltar para a lista de usuários">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h2 className="text-2xl font-bold">Editar usuário</h2>
      </div>

      {isLoading && (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      )}

      {isError && <ErrorState onRetry={() => refetch()} />}

      {/* Row actions already hide "Editar" for an admin account, but that is
          UX only — nothing stops this route from being reached by typing the
          URL directly. The backend refuses the update regardless
          (requireManageableTarget), so this is not a security boundary; it is
          what keeps an admin who lands here from being shown a confusing
          dead-end form: a role selector with no option matching their actual
          role, wired to a submit that can never succeed. */}
      {!isLoading && !isError && user && user.role === 'admin' && (
        <EmptyState
          title="Esta conta não pode ser editada por aqui"
          description="Contas de administrador não são gerenciadas por esta tela."
          action={{ label: 'Voltar para a lista', onClick: () => navigate('/users') }}
        />
      )}

      {!isLoading && !isError && user && user.role !== 'admin' && (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Dados do usuário</CardTitle>
          </CardHeader>
          <CardContent>
            <UserForm
              mode="edit"
              user={user}
              onSubmit={handleSubmit}
              submitting={updateUser.isPending}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
