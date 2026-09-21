import { describe, expect, it } from 'vitest'
import { getPageTitle } from '@/components/layout/AppLayout'

describe('getPageTitle', () => {
  it.each([
    ['/users', 'Usuários'],
    ['/users/new', 'Novo Usuário'],
    ['/users/user-1/edit', 'Editar Usuário'],
    ['/account/security', 'Segurança da Conta'],
  ])('maps %s to %s', (pathname, expected) => {
    expect(getPageTitle(pathname)).toBe(expected)
  })

  it('falls back to the app name for an unmapped route', () => {
    expect(getPageTitle('/something-unmapped')).toBe('Inventory Manager')
  })
})
