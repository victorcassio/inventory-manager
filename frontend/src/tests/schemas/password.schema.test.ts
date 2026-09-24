import { describe, it, expect } from 'vitest'
import {
  passwordFieldSchema,
  activateAccountSchema,
  changePasswordSchema,
} from '@/schemas/password.schema'

describe('passwordFieldSchema', () => {
  it('accepts exactly 12 characters', () => {
    expect(passwordFieldSchema.safeParse('abcdefghijkl').success).toBe(true)
  })

  it('rejects 11 characters', () => {
    expect(passwordFieldSchema.safeParse('abcdefghijk').success).toBe(false)
  })

  it('rejects more than 128 characters', () => {
    expect(passwordFieldSchema.safeParse('a'.repeat(129)).success).toBe(false)
  })

  it('accepts a long passphrase with spaces', () => {
    expect(passwordFieldSchema.safeParse('cavalo de batalha azul e quadrado').success).toBe(true)
  })

  it('accepts Unicode', () => {
    expect(passwordFieldSchema.safeParse('çãoÇÃO-ñ-日本語-ok').success).toBe(true)
  })

  it('does not trim — surrounding spaces count', () => {
    const result = passwordFieldSchema.safeParse(' abcdefghij ')
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe(' abcdefghij ')
  })

  it('rejects blocklisted passwords', () => {
    // Every entry here must be at least 12 characters, otherwise it fails on
    // min() and the assertion proves nothing about the blocklist.
    for (const weak of ['123456789012', 'inventory123', 'Admin@123456']) {
      expect(passwordFieldSchema.safeParse(weak).success).toBe(false)
    }
  })

  it('does not require mixed character classes', () => {
    expect(passwordFieldSchema.safeParse('aaaaaaaaaaaaaa').success).toBe(true)
  })
})

describe('activateAccountSchema', () => {
  it('rejects a mismatched confirmation on the confirmation field', () => {
    const result = activateAccountSchema.safeParse({
      password: 'uma senha bem comprida',
      passwordConfirmation: 'outra senha bem comprida',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['passwordConfirmation'])
    }
  })

  it('accepts a matching confirmation', () => {
    expect(
      activateAccountSchema.safeParse({
        password: 'uma senha bem comprida',
        passwordConfirmation: 'uma senha bem comprida',
      }).success,
    ).toBe(true)
  })
})

describe('changePasswordSchema', () => {
  it('requires a current password', () => {
    expect(
      changePasswordSchema.safeParse({
        currentPassword: '',
        newPassword: 'uma senha bem comprida',
        newPasswordConfirmation: 'uma senha bem comprida',
      }).success,
    ).toBe(false)
  })

  it('rejects a new password equal to the current one', () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: 'uma senha bem comprida',
      newPassword: 'uma senha bem comprida',
      newPasswordConfirmation: 'uma senha bem comprida',
    })
    expect(result.success).toBe(false)
    // The path matters: the message has to land on the field the user must
    // change. Without this the test passes even if the refinement is attached
    // to the wrong field or to the object as a whole.
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['newPassword'])
    }
  })
})
