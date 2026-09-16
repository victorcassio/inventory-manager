import { beforeEach, describe, expect, it } from 'vitest'
import { useAuthStore, AUTH_PERSIST_VERSION } from '@/stores/auth.store'

// A user object exactly as it was persisted before emailVerifiedAt and
// passwordSetAt existed on the type.
const LEGACY_USER = {
  id: '1',
  name: 'Maria',
  email: 'maria@example.com',
  role: 'attendant',
  isActive: true,
  createdAt: '2024-01-01',
}

function writePersisted(state: Record<string, unknown>, version?: number) {
  localStorage.setItem('inventory-auth', JSON.stringify({ state, version }))
}

describe('auth.store persisted-shape migration', () => {
  beforeEach(() => {
    localStorage.clear()
    useAuthStore.setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
    })
  })

  it('fills the new timestamps with null for a session stored before they existed', async () => {
    writePersisted(
      { user: LEGACY_USER, accessToken: 'a', refreshToken: 'r', isAuthenticated: true },
      0,
    )

    await useAuthStore.persist.rehydrate()

    const user = useAuthStore.getState().user
    expect(user).not.toBeNull()
    // null, not undefined: the distinction is the whole point — Tasks 16-19
    // read passwordSetAt to decide whether an account ever set a password.
    expect(user!.emailVerifiedAt).toBeNull()
    expect(user!.passwordSetAt).toBeNull()
    expect('passwordSetAt' in user!).toBe(true)
    // Everything else survives untouched.
    expect(user!.name).toBe('Maria')
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('never overwrites real values stored by a current client', async () => {
    writePersisted(
      {
        user: { ...LEGACY_USER, emailVerifiedAt: '2026-01-01', passwordSetAt: '2026-01-02' },
        accessToken: 'a',
        refreshToken: 'r',
        isAuthenticated: true,
      },
      AUTH_PERSIST_VERSION,
    )

    await useAuthStore.persist.rehydrate()

    expect(useAuthStore.getState().user!.emailVerifiedAt).toBe('2026-01-01')
    expect(useAuthStore.getState().user!.passwordSetAt).toBe('2026-01-02')
  })

  it('tolerates a logged-out payload without inventing a user', async () => {
    writePersisted(
      { user: null, accessToken: null, refreshToken: null, isAuthenticated: false },
      0,
    )

    await useAuthStore.persist.rehydrate()

    expect(useAuthStore.getState().user).toBeNull()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })
})
