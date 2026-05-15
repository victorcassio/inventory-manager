import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { customersApi } from '@/lib/api/customers.api'

export const customerKeys = {
  all: ['customers'] as const,
  list: (params?: object) => [...customerKeys.all, 'list', params] as const,
  detail: (id: string) => [...customerKeys.all, 'detail', id] as const,
}

export function useCustomers(params?: { page?: number; limit?: number; name?: string }) {
  return useQuery({
    queryKey: customerKeys.list(params),
    queryFn: () => customersApi.list(params),
  })
}

export function useCustomer(id: string) {
  return useQuery({
    queryKey: customerKeys.detail(id),
    queryFn: () => customersApi.getById(id),
    enabled: !!id,
  })
}

export function useCreateCustomer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: customersApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: customerKeys.all })
      toast.success('Cliente criado com sucesso')
    },
    onError: () => toast.error('Erro ao criar cliente'),
  })
}

export function useUpdateCustomer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: unknown }) => customersApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: customerKeys.all })
      toast.success('Cliente atualizado')
    },
    onError: () => toast.error('Erro ao atualizar cliente'),
  })
}
