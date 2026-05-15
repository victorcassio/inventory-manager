import { z } from 'zod'

export const paymentSchema = z.object({
  amount: z.coerce.number().min(0.01, 'Valor mínimo R$ 0,01'),
  method: z.enum(['cash', 'pix', 'card', 'transfer'], {
    required_error: 'Forma de pagamento obrigatória',
  }),
  paidAt: z.string().optional(),
  referenceCode: z.string().max(100).optional(),
  notes: z.string().optional(),
})

export type PaymentFormValues = z.infer<typeof paymentSchema>
