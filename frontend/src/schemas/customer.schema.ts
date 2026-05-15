import { z } from 'zod'

export const customerSchema = z.object({
  name: z.string().min(2, 'Nome obrigatório'),
  document: z.string().min(11, 'CPF ou CNPJ inválido').max(18),
  documentType: z.enum(['cpf', 'cnpj']),
  phone: z.string().optional(),
  email: z.string().email('E-mail inválido').optional().or(z.literal('')),
  notes: z.string().optional(),
})

export type CustomerFormValues = z.infer<typeof customerSchema>
