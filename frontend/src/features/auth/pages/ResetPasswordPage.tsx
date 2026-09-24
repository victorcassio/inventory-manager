import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { resetPasswordSchema } from '@/schemas/password.schema'
import { authApi } from '@/lib/api/auth.api'
import { useAuthStore } from '@/stores/auth.store'
import { useFragmentToken } from '../hooks/useFragmentToken'
import { SetPasswordForm } from '../components/SetPasswordForm'

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const token = useFragmentToken()

  return (
    <SetPasswordForm
      schema={resetPasswordSchema}
      title="Redefinir senha"
      submitLabel="Redefinir senha"
      token={token}
      onSubmit={authApi.resetPassword}
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
        toast.success('Senha redefinida. Faça login para continuar.')
        // A reset revokes every session server-side, so there is nothing to
        // resume. `replace` keeps Back off the spent form.
        navigate('/login', { replace: true })
      }}
    />
  )
}
