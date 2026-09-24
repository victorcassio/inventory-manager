import { describe, it, expect } from 'vitest'
import { createUserSchema, updateUserSchema, INVITABLE_ROLES } from '@/schemas/user.schema'

const validCreate = { name: 'Maria', email: 'maria@example.com', role: 'attendant' }

describe('createUserSchema', () => {
  it('accepts the invitable roles', () => {
    for (const role of INVITABLE_ROLES) {
      expect(createUserSchema.safeParse({ ...validCreate, role }).success).toBe(true)
    }
  })

  // The backend enforces this independently (UsersService.create throws
  // ForbiddenException); this pins the client-side guard so a later refactor of
  // the role selector cannot widen it silently.
  it('rejects role admin', () => {
    const result = createUserSchema.safeParse({ ...validCreate, role: 'admin' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['role'])
    }
  })

  it('rejects an absent role with the Portuguese message', () => {
    const result = createUserSchema.safeParse({ name: 'Maria', email: 'maria@example.com' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Selecione um perfil')
    }
  })

  it('normalises the e-mail', () => {
    const result = createUserSchema.safeParse({ ...validCreate, email: '  Maria@Example.COM ' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.email).toBe('maria@example.com')
  })

  it('rejects an invalid e-mail', () => {
    expect(createUserSchema.safeParse({ ...validCreate, email: 'nao-e-email' }).success).toBe(false)
  })

  it('rejects a blank name', () => {
    expect(createUserSchema.safeParse({ ...validCreate, name: '   ' }).success).toBe(false)
  })
})

describe('updateUserSchema', () => {
  it('rejects role admin', () => {
    const result = updateUserSchema.safeParse({ name: 'Maria', role: 'admin' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['role'])
    }
  })

  it('accepts an invitable role', () => {
    expect(updateUserSchema.safeParse({ name: 'Maria', role: 'financial' }).success).toBe(true)
  })

  // The edit form has no e-mail field: the backend refuses to change an
  // address, so the schema must not carry one.
  it('has no email field', () => {
    const result = updateUserSchema.safeParse({
      name: 'Maria',
      role: 'financial',
      email: 'outra@example.com',
    })
    expect(result.success).toBe(true)
    if (result.success) expect('email' in result.data).toBe(false)
  })
})
