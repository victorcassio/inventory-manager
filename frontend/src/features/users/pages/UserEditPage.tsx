import { useRef } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingSpinner } from '@/components/feedback/LoadingSpinner'
import { ErrorState } from '@/components/feedback/ErrorState'
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

      {!isLoading && !isError && user && (
        <Card className="max-w-lg">
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
