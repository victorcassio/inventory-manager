import { z } from 'zod'

const returnItemSchema = z.object({
  rentalItemId: z.string().min(1, 'Item obrigatório'),
  quantity: z.coerce.number().int().min(1, 'Quantidade mínima 1'),
  condition: z.enum(['good', 'damaged', 'lost']),
  damageFee: z.coerce.number().min(0).optional(),
  notes: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.condition === 'good' && data.damageFee && data.damageFee > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Taxa de dano deve ser 0 para itens em bom estado',
      path: ['damageFee'],
    })
  }
  if ((data.condition === 'damaged' || data.condition === 'lost') && (!data.damageFee || data.damageFee <= 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Taxa de dano obrigatória para itens danificados ou extraviados',
      path: ['damageFee'],
    })
  }
})

export const returnSchema = z.object({
  returnedAt: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(returnItemSchema).min(1, 'Selecione pelo menos 1 item para devolver'),
})

export type ReturnFormValues = z.infer<typeof returnSchema>
export type ReturnItemFormValues = z.infer<typeof returnItemSchema>
