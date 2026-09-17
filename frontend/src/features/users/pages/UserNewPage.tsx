import { useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { UserForm } from '../components/UserForm'
import { useCreateUser } from '../hooks/useUsers'
import type { CreateUserFormValues } from '@/schemas/user.schema'

export function UserNewPage() {
  const navigate = useNavigate()
  const createUser = useCreateUser()
  // Joined, not dropped: see SetPasswordForm for why returning early on a
  // second submit would desync React Hook Form's isSubmitting.
  const inFlight = useRef<Promise<unknown> | null>(null)

  const handleSubmit = (values: CreateUserFormValues) => {
    if (inFlight.current) return
    const request = createUser
      .mutateAsync(values)
      .then(() => {
        navigate('/users')
      })
      .catch(() => {
        // The mutation's own onError already surfaced a toast; staying on the
        // form is what lets the admin correct the input and retry.
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
        <h2 className="text-2xl font-bold">Novo usuário</h2>
      </div>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Dados do usuário</CardTitle>
        </CardHeader>
        <CardContent>
          <UserForm mode="create" onSubmit={handleSubmit} submitting={createUser.isPending} />
        </CardContent>
      </Card>
    </div>
  )
}
