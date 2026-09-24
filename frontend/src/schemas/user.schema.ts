import { z } from 'zod'

export const INVITABLE_ROLES = ['attendant', 'financial'] as const

export const createUserSchema = z.object({
  name: z.string().trim().min(1, 'Nome obrigatório').max(100, 'Máximo de 100 caracteres'),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('E-mail inválido')
    .max(150, 'Máximo de 150 caracteres'),
  role: z.enum(INVITABLE_ROLES, { errorMap: () => ({ message: 'Selecione um perfil' }) }),
})

export const updateUserSchema = z.object({
  name: z.string().trim().min(1, 'Nome obrigatório').max(100, 'Máximo de 100 caracteres'),
  role: z.enum(INVITABLE_ROLES, { errorMap: () => ({ message: 'Selecione um perfil' }) }),
})

export type CreateUserFormValues = z.infer<typeof createUserSchema>
export type UpdateUserFormValues = z.infer<typeof updateUserSchema>
