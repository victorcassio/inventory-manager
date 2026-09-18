import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { UserRowActions } from '@/features/users/components/UserRowActions'
import {
  useResendInvitation,
  useRevokeInvitation,
  useUpdateUserStatus,
} from '@/features/users/hooks/useUsers'
import type { AdminUser } from '@/types'

vi.mock('@/features/users/hooks/useUsers', () => ({
  useUpdateUserStatus: vi.fn(),
  useResendInvitation: vi.fn(),
  useRevokeInvitation: vi.fn(),
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn() }
})

/**
 * The real ConfirmDialog is Radix's AlertDialog, and AlertDialogContent plays
 * a genuine CSS exit animation (animate-out, duration-200). Radix's Presence
 * keeps the confirm button mounted and clickable for that whole window in
 * every real browser — a fast second click lands on it before React ever
 * unmounts the dialog. jsdom has no CSS engine, so Presence sees no animation
 * and removes the node the instant `open` goes false — which is also true of
 * an ordinary `open ? <Dialog/> : null` stand-in with no animation of its own:
 * it unmounts on React's very next render, exactly like jsdom's fake Presence
 * does, and so it would be just as blind to the race as the real component
 * was.
 *
 * What is actually under test here is narrower than "does the dialog stay
 * open": it is whether the `onConfirm` CALLBACK — the closure that holds
 * UserRowActions' own in-flight ref guard — survives being invoked twice in a
 * row. That question doesn't need the dialog's mount lifecycle at all, so this
 * stand-in renders the confirm button unconditionally and never removes it,
 * isolating the guard from Radix/Presence/animation timing entirely (all of
 * which are ConfirmDialog's own concern, already covered elsewhere against
 * the real component).
 */
vi.mock('@/components/feedback/ConfirmDialog', () => ({
  ConfirmDialog: ({
    confirmLabel,
    onConfirm,
  }: {
    confirmLabel?: string
    onConfirm: () => void
  }) => <button onClick={onConfirm}>{confirmLabel ?? 'Confirmar'}</button>,
}))

function makeAdminUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: 'other-1',
    name: 'Ana Atendente',
    email: 'ana@example.com',
    role: 'attendant',
    isActive: true,
    emailVerifiedAt: '2026-01-01T00:00:00Z',
    passwordSetAt: '2026-01-01T00:00:00Z',
    lastLogin: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    invitationStatus: 'pending',
    invitationExpiresAt: '2026-01-02T00:00:00Z',
    ...overrides,
  }
}

function renderActions(user: AdminUser, currentUserId = 'me-1') {
  return render(
    <MemoryRouter>
      <UserRowActions user={user} currentUserId={currentUserId} />
    </MemoryRouter>,
  )
}

describe('UserRowActions — onConfirm guard survives two invocations', () => {
  const statusMutate = vi.fn()
  const resendMutate = vi.fn()
  const revokeMutate = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useUpdateUserStatus).mockReturnValue({ mutate: statusMutate, isPending: false } as never)
    vi.mocked(useResendInvitation).mockReturnValue({ mutate: resendMutate, isPending: false } as never)
    vi.mocked(useRevokeInvitation).mockReturnValue({ mutate: revokeMutate, isPending: false } as never)
  })

  it('does not send a second status mutation when the confirm button is clicked twice', () => {
    renderActions(makeAdminUser({ isActive: true }))

    // The stand-in renders both dialogs' buttons unconditionally, so "Desativar"
    // here is unambiguously the CONFIRM button, not the row's own toggle.
    const confirmButton = screen.getByRole('button', { name: 'Desativar' })

    fireEvent.click(confirmButton)
    fireEvent.click(confirmButton)

    expect(statusMutate).toHaveBeenCalledTimes(1)
  })

  it('does not send a second revoke mutation when the confirm button is clicked twice', () => {
    renderActions(makeAdminUser({ invitationStatus: 'pending' }))

    const confirmButton = screen.getByRole('button', { name: 'Revogar' })

    fireEvent.click(confirmButton)
    fireEvent.click(confirmButton)

    expect(revokeMutate).toHaveBeenCalledTimes(1)
  })
})
