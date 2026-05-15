import { z } from 'zod'

export const categorySchema = z.object({
  name: z.string().min(1, 'Nome obrigatório'),
  description: z.string().optional(),
})

export const itemSchema = z.object({
  categoryId: z.string().uuid('Categoria obrigatória'),
  name: z.string().min(1, 'Nome obrigatório'),
  code: z.string().min(1, 'Código obrigatório'),
  dailyRate: z.coerce.number().min(0.01, 'Valor diário obrigatório'),
  totalQty: z.coerce.number().int().min(1, 'Quantidade mínima 1'),
  description: z.string().optional(),
  notes: z.string().optional(),
})

export type CategoryFormValues = z.infer<typeof categorySchema>
export type ItemFormValues = z.infer<typeof itemSchema>
