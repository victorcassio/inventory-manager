import { z } from 'zod'

export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 128

/** Mirrors the backend blocklist. The backend remains authoritative. */
const COMMON_PASSWORDS = new Set(
  [
    '123456', '1234567', '12345678', '123456789', '1234567890', '123456789012',
    'password', 'password1', 'password123', 'passw0rd',
    'senha123', 'senha12345', 'qwerty', 'qwerty123', 'qwertyuiop',
    'admin', 'admin123', 'admin@123', 'admin@123456', 'administrador',
    'iloveyou', 'letmein', 'welcome', 'welcome123', 'abc123', 'abcd1234',
    '111111', '000000', 'inventory', 'inventory123',
  ].map((p) => p.toLowerCase()),
)

/** Rendered by PasswordRequirements. Each predicate receives the raw value. */
export const PASSWORD_RULES = [
  {
    id: 'min',
    label: `Pelo menos ${PASSWORD_MIN_LENGTH} caracteres`,
    test: (value: string) => value.length >= PASSWORD_MIN_LENGTH,
  },
  {
    id: 'max',
    label: `No máximo ${PASSWORD_MAX_LENGTH} caracteres`,
    test: (value: string) => value.length <= PASSWORD_MAX_LENGTH,
  },
  {
    id: 'common',
    label: 'Não pode ser uma senha muito comum',
    test: (value: string) => value.length === 0 || !COMMON_PASSWORDS.has(value.toLowerCase()),
  },
] as const

// No .trim(): spaces are legitimate password characters.
export const passwordFieldSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `A senha deve ter no mínimo ${PASSWORD_MIN_LENGTH} caracteres`)
  .max(PASSWORD_MAX_LENGTH, `A senha deve ter no máximo ${PASSWORD_MAX_LENGTH} caracteres`)
  .refine((value) => !COMMON_PASSWORDS.has(value.toLowerCase()), {
    message: 'Esta senha é muito comum. Escolha uma senha menos previsível',
  })

export const forgotPasswordSchema = z.object({
  // Normalised like createUserSchema's e-mail: a pasted address with a stray
  // space or capital should not be rejected in the browser.
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
})

const withConfirmation = z
  .object({
    password: passwordFieldSchema,
    passwordConfirmation: z.string(),
  })
  .refine((data) => data.password === data.passwordConfirmation, {
    message: 'A confirmação não corresponde à senha',
    path: ['passwordConfirmation'],
  })

export const activateAccountSchema = withConfirmation
export const resetPasswordSchema = withConfirmation

export const changePasswordSchema = z
  .object({
    // max mirrors ChangePasswordDto's 200-character bound.
    currentPassword: z
      .string()
      .min(1, 'Informe sua senha atual')
      .max(200, 'Senha atual excede o limite'),
    newPassword: passwordFieldSchema,
    newPasswordConfirmation: z.string(),
  })
  .refine((data) => data.newPassword === data.newPasswordConfirmation, {
    message: 'A confirmação não corresponde à senha',
    path: ['newPasswordConfirmation'],
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: 'A nova senha deve ser diferente da senha atual',
    path: ['newPassword'],
  })

export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>
export type SetPasswordFormValues = z.infer<typeof withConfirmation>
export type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>
