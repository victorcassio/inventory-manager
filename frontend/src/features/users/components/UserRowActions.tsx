import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import type { AdminUser } from '@/types'
import {
  canChangeStatus,
  canEdit,
  canResendInvitation,
  canRevokeInvitation,
  hasNoActions,
} from '../lib/userActions'
import { useResendInvitation, useRevokeInvitation, useUpdateUserStatus } from '../hooks/useUsers'

interface UserRowActionsProps {
  user: AdminUser
  currentUserId?: string
}

type PendingConfirmation = 'status' | 'revoke' | null

export function UserRowActions({ user, currentUserId }: UserRowActionsProps) {
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState<PendingConfirmation>(null)

  const status = useUpdateUserStatus()
  const resend = useResendInvitation()
  const revoke = useRevokeInvitation()

  // One row at a time. Every mutation in this area shares a scope, so a second
  // click while one is running would queue rather than race — but the control
  // should also stop inviting it.
  const busy = status.isPending || resend.isPending || revoke.isPending

  // Resend has no confirmation step between the click and the mutation, so a
  // fast double click reaches mutate() twice before `busy` flips true on a
  // re-render — the same same-tick window Task 17 found in the password
  // forms. The mutation's shared scope only serialises the two calls, it does
  // not drop the second one, so without this it would just send a delayed
  // second invitation rather than none. Status and revoke go through
  // ConfirmDialog first, which Radix closes after one click, so they do not
  // need a second guard here.
  const resendInFlight = useRef(false)
  const handleResend = () => {
    if (resendInFlight.current) return
    resendInFlight.current = true
    resend.mutate(user.id, { onSettled: () => { resendInFlight.current = false } })
  }

  const edit = canEdit(user)
  const statusChange = canChangeStatus(user, currentUserId)
  const resendInvite = canResendInvitation(user)
  const revokeInvite = canRevokeInvitation(user)

  if (hasNoActions(user, currentUserId)) {
    return (
      <span className="text-sm text-muted-foreground">
        <span aria-hidden="true">—</span>
        <span className="sr-only">
          Sem ações disponíveis. {edit.reason ?? statusChange.reason}
        </span>
      </span>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {edit.available && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => navigate(`/users/${user.id}/edit`)}
        >
          Editar
          <span className="sr-only"> {user.name}</span>
        </Button>
      )}

      {resendInvite.available && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={handleResend}
        >
          Reenviar convite
          <span className="sr-only"> para {user.name}</span>
        </Button>
      )}

      {revokeInvite.available && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => setConfirming('revoke')}
        >
          Revogar convite
          <span className="sr-only"> de {user.name}</span>
        </Button>
      )}

      {statusChange.available ? (
        <Button
          variant={user.isActive ? 'outline' : 'default'}
          size="sm"
          disabled={busy}
          onClick={() => setConfirming('status')}
        >
          {user.isActive ? 'Desativar' : 'Ativar'}
          <span className="sr-only"> {user.name}</span>
        </Button>
      ) : (
        statusChange.reason &&
        user.role !== 'admin' && (
          // Shown rather than hidden: an admin looking at their own row should
          // be told why the control is absent, not left wondering.
          <Button variant="outline" size="sm" disabled aria-describedby={`no-status-${user.id}`}>
            Desativar
            <span id={`no-status-${user.id}`} className="sr-only">
              {statusChange.reason}
            </span>
          </Button>
        )
      )}

      <ConfirmDialog
        open={confirming === 'status'}
        title={user.isActive ? 'Desativar usuário' : 'Ativar usuário'}
        description={
          user.isActive
            ? `${user.name} perderá o acesso imediatamente e as sessões abertas serão encerradas.`
            : `${user.name} voltará a ter acesso ao sistema.`
        }
        confirmLabel={user.isActive ? 'Desativar' : 'Ativar'}
        destructive={user.isActive}
        onConfirm={() => {
          setConfirming(null)
          status.mutate({ id: user.id, isActive: !user.isActive })
        }}
        onCancel={() => setConfirming(null)}
      />

      <ConfirmDialog
        open={confirming === 'revoke'}
        title="Revogar convite"
        description={`O link enviado a ${user.name} deixará de funcionar. É possível enviar um novo convite depois.`}
        confirmLabel="Revogar"
        destructive
        onConfirm={() => {
          setConfirming(null)
          revoke.mutate(user.id)
        }}
        onCancel={() => setConfirming(null)}
      />
    </div>
  )
}
