import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import {
  userKeys,
  useCreateUser,
  useResendInvitation,
  useRevokeInvitation,
  useUpdateUserStatus,
  CREATED_MESSAGE,
  CREATED_MAIL_FAILED_MESSAGE,
  RESENT_MESSAGE,
  RESEND_MAIL_FAILED_MESSAGE,
} from '@/features/users/hooks/useUsers'
import { usersApi } from '@/lib/api/users.api'
import type { AdminUser } from '@/types'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/api/users.api', () => ({
  usersApi: {
    list: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateStatus: vi.fn(),
    resendInvitation: vi.fn(),
    revokeInvitation: vi.fn(),
  },
}))

function makeAdminUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: 'u-1',
    name: 'Ana Atendente',
    email: 'ana@example.com',
    role: 'attendant',
    isActive: true,
    emailVerifiedAt: '2026-01-01T00:00:00Z',
    passwordSetAt: null,
    lastLogin: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    invitationStatus: 'pending',
    invitationExpiresAt: '2026-01-02T00:00:00Z',
    ...overrides,
  }
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, wrapper }
}

describe('useUsers — invitation feedback', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reports a sent invitation as success, distinct from a failed send', async () => {
    const { wrapper } = createWrapper()
    vi.mocked(usersApi.create).mockResolvedValue({
      user: makeAdminUser(),
      invitationEmailSent: true,
    })

    const { result } = renderHook(() => useCreateUser(), { wrapper })
    await act(async () => {
      result.current.mutate({ name: 'Ana', email: 'ana@example.com', role: 'attendant' })
    })

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(CREATED_MESSAGE))
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('never claims delivery the API did not confirm', async () => {
    const { wrapper } = createWrapper()
    vi.mocked(usersApi.create).mockResolvedValue({
      user: makeAdminUser(),
      invitationEmailSent: false,
    })

    const { result } = renderHook(() => useCreateUser(), { wrapper })
    await act(async () => {
      result.current.mutate({ name: 'Ana', email: 'ana@example.com', role: 'attendant' })
    })

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(CREATED_MAIL_FAILED_MESSAGE))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('distinguishes a successful resend from a failed one', async () => {
    const { wrapper } = createWrapper()
    vi.mocked(usersApi.resendInvitation).mockResolvedValue({
      user: makeAdminUser(),
      invitationEmailSent: true,
    })

    const { result } = renderHook(() => useResendInvitation(), { wrapper })
    await act(async () => {
      result.current.mutate('u-1')
    })

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(RESENT_MESSAGE))

    vi.mocked(usersApi.resendInvitation).mockResolvedValue({
      user: makeAdminUser(),
      invitationEmailSent: false,
    })
    await act(async () => {
      result.current.mutate('u-1')
    })
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(RESEND_MAIL_FAILED_MESSAGE))
  })
})

describe('useUsers — query invalidation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('invalidates the users list and detail after a status change, and nothing unrelated', async () => {
    const { queryClient, wrapper } = createWrapper()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    vi.mocked(usersApi.updateStatus).mockResolvedValue(makeAdminUser({ isActive: false }))

    const { result } = renderHook(() => useUpdateUserStatus(), { wrapper })
    await act(async () => {
      result.current.mutate({ id: 'u-1', isActive: false })
    })

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled())

    const calledKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey)
    expect(calledKeys).toEqual(
      expect.arrayContaining([userKeys.lists(), userKeys.detail('u-1')]),
    )
    // Never a bare invalidateAll with no key — that would refetch everything
    // in the app's cache, not just this feature's data.
    for (const key of calledKeys) {
      expect(key?.[0]).toBe('users')
    }
  })

  it('invalidates on revoke using the id passed to the mutation', async () => {
    const { queryClient, wrapper } = createWrapper()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    vi.mocked(usersApi.revokeInvitation).mockResolvedValue(undefined)

    const { result } = renderHook(() => useRevokeInvitation(), { wrapper })
    await act(async () => {
      result.current.mutate('u-1')
    })

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: userKeys.detail('u-1') }),
      ),
    )
  })
})

describe('useUsers — concurrent mutations on one row', () => {
  beforeEach(() => vi.clearAllMocks())

  it('serialises mutations sharing the admin scope, so an older response cannot land after a newer one', async () => {
    const { wrapper } = createWrapper()

    let resolveFirst!: (user: AdminUser) => void
    const first = new Promise<AdminUser>((resolve) => {
      resolveFirst = resolve
    })
    vi.mocked(usersApi.updateStatus)
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => Promise.resolve(makeAdminUser({ isActive: true })))

    const { result: statusResult } = renderHook(() => useUpdateUserStatus(), { wrapper })
    const { result: revokeResult } = renderHook(() => useRevokeInvitation(), { wrapper })
    vi.mocked(usersApi.revokeInvitation).mockResolvedValue(undefined)

    // Fire the slow status mutation, then the revoke — both act on the same
    // row and share the admin scope, so React Query runs them one at a time
    // rather than letting the slow one's stale result land after the fast one.
    act(() => {
      statusResult.current.mutate({ id: 'u-1', isActive: false })
    })
    await waitFor(() => expect(usersApi.updateStatus).toHaveBeenCalled())

    act(() => {
      revokeResult.current.mutate('u-1')
    })

    // Give the revoke's mutationFn every reasonable chance to fire if it were
    // going to run immediately, so this is a real assertion about scoping and
    // not just "nothing has flushed yet".
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(usersApi.revokeInvitation).not.toHaveBeenCalled()

    await act(async () => {
      resolveFirst(makeAdminUser({ isActive: false }))
    })

    await waitFor(() => expect(usersApi.revokeInvitation).toHaveBeenCalled())
  })
})
