import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { activateAccountSchema } from '@/schemas/password.schema'
import { authApi } from '@/lib/api/auth.api'
import { useAuthStore } from '@/stores/auth.store'
import { useFragmentToken } from '../hooks/useFragmentToken'
import { SetPasswordForm } from '../components/SetPasswordForm'

export function ActivateAccountPage() {
  const navigate = useNavigate()
  const token = useFragmentToken()

  return (
    <SetPasswordForm
      schema={activateAccountSchema}
      title="Ativar conta"
      submitLabel="Definir senha"
      token={token}
      onSubmit={authApi.activateAccount}
      onSuccess={() => {
        // Whatever session this browser was holding is dead: a reset revokes
        // every refresh row and moves passwordChangedAt, which kills the
        // access tokens too. Clearing locally means we do not admit the user
        // to the app shell on stale credentials, and do not leave those
        // credentials and their user object sitting in localStorage on what
        // may be a shared machine — right after the action someone performs
        // precisely because they think they were compromised. Idempotent when
        // there was no session.
        useAuthStore.getState().clearAuth()
        toast.success('Senha definida. Faça login para continuar.')
        // Deliberately no auto-login: activation returns no tokens, and the
        // user proves they know the password they just set. `replace` so Back
        // cannot return to a form whose single-use token is now spent.
        navigate('/login', { replace: true })
      }}
    />
  )
}
