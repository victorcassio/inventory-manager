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
        // Activation itself revokes nothing server-side — it only sets a
        // password on an account that never had a session. This clears
        // whatever UNRELATED session this browser happened to be holding
        // (e.g. someone else's, on a shared machine) purely as a local
        // precaution, so the person who just proved they hold this invite
        // link is never silently admitted to a stranger's already-open app
        // shell. It does not revoke that other session's refresh token
        // remotely — see the backlog note on clearAuth() and shared devices
        // in docs/security-checklist-deploy.md. Idempotent when there was no
        // session to begin with.
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
