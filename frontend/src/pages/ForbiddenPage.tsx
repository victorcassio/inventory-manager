import { useNavigate } from 'react-router-dom'
import { ShieldOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth.store'

export function ForbiddenPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <ShieldOff className="mb-4 h-16 w-16 text-destructive" />
      <h1 className="text-4xl font-bold">403</h1>
      <h2 className="mt-2 text-2xl font-semibold">Acesso negado</h2>
      <p className="mt-2 text-muted-foreground">
        Você não tem permissão para acessar esta página.
        {user && (
          <> Seu perfil atual é <strong>{user.role}</strong>.</>
        )}
      </p>
      <Button className="mt-6" onClick={() => navigate('/dashboard')}>
        Ir para o Dashboard
      </Button>
    </div>
  )
}
