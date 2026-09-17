import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/formatters'
import type { InvitationStatus } from '@/types'

const LABELS: Record<InvitationStatus, string> = {
  none: 'Sem convite',
  pending: 'Convite pendente',
  expired: 'Convite expirado',
  revoked: 'Convite revogado',
  accepted: 'Convite aceito',
}

const VARIANTS: Record<InvitationStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  none: 'outline',
  pending: 'default',
  expired: 'secondary',
  revoked: 'secondary',
  accepted: 'outline',
}

interface InvitationStatusBadgeProps {
  status: InvitationStatus
  /**
   * The backend only ever populates this for a pending invitation — null in
   * every other status (see AdminUser's doc comment). Accepted here as an
   * extra guard: even if a caller passed a stale value alongside a non-pending
   * status, it is never rendered outside `pending`.
   */
  expiresAt?: string | null
}

/**
 * Always the words, never only the colour: the label is the information and the
 * variant only reinforces it (WCAG 1.4.1).
 */
export function InvitationStatusBadge({ status, expiresAt }: InvitationStatusBadgeProps) {
  return (
    <div className="inline-flex flex-col gap-0.5">
      <Badge variant={VARIANTS[status]} data-testid={`invitation-${status}`}>
        {LABELS[status]}
      </Badge>
      {status === 'pending' && expiresAt && (
        <span className="text-xs text-muted-foreground">Expira em {formatDate(expiresAt)}</span>
      )}
    </div>
  )
}

export { LABELS as INVITATION_LABELS }
