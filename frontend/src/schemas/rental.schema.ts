import { z } from 'zod'

const rentalItemSchema = z.object({
  itemId: z.string().uuid('Item obrigatório'),
  quantity: z.coerce.number().int().min(1, 'Quantidade mínima 1'),
})

export const rentalSchema = z.object({
  customerId: z.string().uuid('Cliente obrigatório'),
  startDate: z.string().min(1, 'Data de início obrigatória'),
  expectedReturn: z.string().min(1, 'Data de devolução obrigatória'),
  deposit: z.coerce.number().min(0).optional(),
  discount: z.coerce.number().min(0).optional(),
  notes: z.string().optional(),
  items: z.array(rentalItemSchema).min(1, 'Adicione pelo menos 1 item'),
}).refine(
  (data) => new Date(data.expectedReturn) > new Date(data.startDate),
  { message: 'Data de devolução deve ser posterior à data de início', path: ['expectedReturn'] },
)

export type RentalFormValues = z.infer<typeof rentalSchema>
