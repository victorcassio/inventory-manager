import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
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

const mockUseUpdateUserStatus = useUpdateUserStatus as unknown as ReturnType<typeof vi.fn>
const mockUseResendInvitation = useResendInvitation as unknown as ReturnType<typeof vi.fn>
const mockUseRevokeInvitation = useRevokeInvitation as unknown as ReturnType<typeof vi.fn>

function makeAdminUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: 'u-1',
    name: 'Ana Atendente',
    email: 'ana@example.com',
    role: 'attendant',
    isActive: true,
    emailVerifiedAt: '2026-01-01T00:00:00Z',
    passwordSetAt: '2026-01-01T00:00:00Z',
    lastLogin: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    invitationStatus: 'accepted',
    invitationExpiresAt: null,
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

describe('UserRowActions', () => {
  const statusMutate = vi.fn()
  const resendMutate = vi.fn()
  const revokeMutate = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseUpdateUserStatus.mockReturnValue({ mutate: statusMutate, isPending: false })
    mockUseResendInvitation.mockReturnValue({ mutate: resendMutate, isPending: false })
    mockUseRevokeInvitation.mockReturnValue({ mutate: revokeMutate, isPending: false })
  })

  it('shows no actions for an admin account', () => {
    renderActions(makeAdminUser({ id: 'admin-1', role: 'admin' }))

    expect(screen.queryByRole('button', { name: /editar/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /desativar/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ativar/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reenviar convite/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /revogar convite/i })).not.toBeInTheDocument()
  })

  it('cannot deactivate its own account: the control is disabled with a reason', () => {
    renderActions(makeAdminUser({ id: 'me-1', isActive: true }), 'me-1')

    const button = screen.getByRole('button', { name: /desativar/i })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription(/não pode alterar o status da sua própria conta/i)
  })

  it('can deactivate a different active user, with confirmation', async () => {
    const user = userEvent.setup()
    renderActions(makeAdminUser({ id: 'other-1', isActive: true }), 'me-1')

    await user.click(screen.getByRole('button', { name: /desativar/i }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(/desativar usuário/i)

    await user.click(screen.getByRole('button', { name: 'Desativar' }))
    expect(statusMutate).toHaveBeenCalledWith(
      { id: 'other-1', isActive: false },
      expect.anything(),
    )
  })

  it('cancels the status confirmation on Escape without mutating', async () => {
    const user = userEvent.setup()
    renderActions(makeAdminUser({ id: 'other-1', isActive: true }), 'me-1')

    await user.click(screen.getByRole('button', { name: /desativar/i }))
    await screen.findByRole('alertdialog')

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(statusMutate).not.toHaveBeenCalled()
  })

  it('offers resend invitation only for an active user with no password set and a non-accepted invite', () => {
    const { rerender } = render(
      <MemoryRouter>
        <UserRowActions
          user={makeAdminUser({
            id: 'other-1',
            isActive: true,
            passwordSetAt: null,
            invitationStatus: 'pending',
          })}
          currentUserId="me-1"
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('button', { name: /reenviar convite/i })).toBeInTheDocument()

    // Already has a password: resend must not be offered.
    rerender(
      <MemoryRouter>
        <UserRowActions
          user={makeAdminUser({ id: 'other-1', isActive: true, passwordSetAt: '2026-01-01' })}
          currentUserId="me-1"
        />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('button', { name: /reenviar convite/i })).not.toBeInTheDocument()

    // Inactive: resend must not be offered until reactivated.
    rerender(
      <MemoryRouter>
        <UserRowActions
          user={makeAdminUser({
            id: 'other-1',
            isActive: false,
            passwordSetAt: null,
            invitationStatus: 'pending',
          })}
          currentUserId="me-1"
        />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('button', { name: /reenviar convite/i })).not.toBeInTheDocument()
  })

  it('confirming a status change mutates exactly once through the real dialog', async () => {
    renderActions(makeAdminUser({ id: 'other-1', isActive: true }), 'me-1')

    fireEvent.click(screen.getByRole('button', { name: /^desativar/i }))
    const confirmButton = await screen.findByRole('button', { name: 'Desativar' })
    fireEvent.click(confirmButton)

    // NOTE: this does not exercise the double-click race. Radix's real
    // AlertDialogContent plays a CSS exit animation (animate-out,
    // duration-200), and Presence keeps the confirm button mounted and
    // clickable for that whole window in a real browser — jsdom has no CSS
    // engine, so Presence sees no animation and unmounts the node
    // synchronously on this first click. A second fireEvent.click here would
    // land on a detached node and prove nothing. The real race — two clicks
    // both landing before React unmounts — is covered in
    // UserRowActions.confirmRace.test.tsx against a stand-in dialog that
    // doesn't depend on jsdom's inert CSS to stay honest.
    expect(statusMutate).toHaveBeenCalledTimes(1)
  })

  it('does not send a second resend request when two clicks land in the same tick', async () => {
    renderActions(
      makeAdminUser({
        id: 'other-1',
        isActive: true,
        passwordSetAt: null,
        invitationStatus: 'pending',
      }),
      'me-1',
    )

    const button = screen.getByRole('button', { name: /reenviar convite/i })
    // Two native click events fired synchronously, before React commits any
    // re-render — the window a real fast double click or a stuck trackpad can
    // hit, since aria-disabled and isPending both only take effect after one.
    fireEvent.click(button)
    fireEvent.click(button)

    expect(resendMutate).toHaveBeenCalledTimes(1)
  })

  it('resend invitation never reactivates the user', async () => {
    const user = userEvent.setup()
    renderActions(
      makeAdminUser({
        id: 'other-1',
        isActive: true,
        passwordSetAt: null,
        invitationStatus: 'pending',
      }),
      'me-1',
    )

    await user.click(screen.getByRole('button', { name: /reenviar convite/i }))

    expect(resendMutate).toHaveBeenCalledWith('other-1', expect.anything())
    // resendMutate's first argument is the id alone — it never touches isActive.
    expect(resendMutate.mock.calls[0][0]).toBe('other-1')
    expect(resendMutate.mock.calls[0][0]).not.toEqual(expect.objectContaining({ isActive: true }))
  })

  it('shows a clear, confirmable revoke action for a pending invitation', async () => {
    const user = userEvent.setup()
    renderActions(makeAdminUser({ id: 'other-1', invitationStatus: 'pending' }), 'me-1')

    const revokeButton = screen.getByRole('button', { name: /revogar convite/i })
    expect(revokeButton).toBeInTheDocument()

    await user.click(revokeButton)
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(/revogar convite/i)

    await user.click(screen.getByRole('button', { name: 'Revogar' }))
    expect(revokeMutate).toHaveBeenCalledWith('other-1', expect.anything())
  })

  it('does not offer revoke for a non-pending invitation', () => {
    renderActions(makeAdminUser({ id: 'other-1', invitationStatus: 'accepted' }), 'me-1')
    expect(screen.queryByRole('button', { name: /revogar convite/i })).not.toBeInTheDocument()
  })

  it('disables every action while a mutation is in flight', () => {
    mockUseUpdateUserStatus.mockReturnValue({ mutate: statusMutate, isPending: true })
    renderActions(
      makeAdminUser({
        id: 'other-1',
        isActive: true,
        passwordSetAt: null,
        invitationStatus: 'pending',
      }),
      'me-1',
    )

    expect(screen.getByRole('button', { name: /editar/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /reenviar convite/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /revogar convite/i })).toBeDisabled()
  })
})
