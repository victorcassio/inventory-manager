import { z } from 'zod'

export const CATEGORY_LABELS: Record<string, string> = {
  rental_income:    'Receita de Locação',
  stock_investment: 'Investimento em Estoque',
  maintenance:      'Manutenção',
  transport:        'Transporte',
  fixed_cost:       'Custo Fixo',
  other:            'Outro',
}

export const ORIGIN_LABELS: Record<string, string> = {
  manual:     'Manual',
  payment:    'Pagamento',
  adjustment: 'Ajuste',
}

export const TYPE_LABELS: Record<string, string> = {
  income:  'Entrada',
  expense: 'Saída',
}

export const createTransactionSchema = z.object({
  type: z.enum(['income', 'expense'], { required_error: 'Tipo obrigatório' }),
  category: z.enum(
    ['rental_income', 'stock_investment', 'maintenance', 'transport', 'fixed_cost', 'other'],
    { required_error: 'Categoria obrigatória' },
  ),
  amount: z
    .number({ invalid_type_error: 'Valor deve ser um número' })
    .positive('Valor deve ser maior que zero'),
  transactionDate: z.string().date('Data inválida'),
  description: z.string().min(1, 'Descrição obrigatória'),
  rentalId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal(''))
    .transform(v => (v === '' ? undefined : v)),
})

export type CreateTransactionFormValues = z.infer<typeof createTransactionSchema>

export const updateTransactionSchema = createTransactionSchema
export type UpdateTransactionFormValues = z.infer<typeof updateTransactionSchema>

export const voidTransactionSchema = z.object({
  reason: z.string().min(1, 'Motivo obrigatório'),
})

export type VoidTransactionFormValues = z.infer<typeof voidTransactionSchema>
