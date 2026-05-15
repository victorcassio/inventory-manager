import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { inventoryApi } from '@/lib/api/inventory.api'

export const inventoryKeys = {
  all: ['inventory'] as const,
  categories: () => [...inventoryKeys.all, 'categories'] as const,
  items: (params?: object) => [...inventoryKeys.all, 'items', params] as const,
  item: (id: string) => [...inventoryKeys.all, 'items', id] as const,
}

export function useCategories() {
  return useQuery({
    queryKey: inventoryKeys.categories(),
    queryFn: inventoryApi.listCategories,
  })
}

export function useItems(params?: { page?: number; limit?: number; categoryId?: string; availableOnly?: boolean }) {
  return useQuery({
    queryKey: inventoryKeys.items(params),
    queryFn: () => inventoryApi.listItems(params),
  })
}

export function useItem(id: string) {
  return useQuery({
    queryKey: inventoryKeys.item(id),
    queryFn: () => inventoryApi.getItem(id),
    enabled: !!id,
  })
}

export function useCreateItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: inventoryApi.createItem,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inventoryKeys.all })
      toast.success('Item criado com sucesso')
    },
    onError: () => toast.error('Erro ao criar item'),
  })
}

export function useUpdateItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: unknown }) => inventoryApi.updateItem(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inventoryKeys.all })
      toast.success('Item atualizado')
    },
    onError: () => toast.error('Erro ao atualizar item'),
  })
}

export function useCreateCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: inventoryApi.createCategory,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inventoryKeys.categories() })
      toast.success('Categoria criada com sucesso')
    },
    onError: () => toast.error('Erro ao criar categoria'),
  })
}

export function useUpdateCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: unknown }) => inventoryApi.updateCategory(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inventoryKeys.categories() })
      toast.success('Categoria atualizada')
    },
    onError: () => toast.error('Erro ao atualizar categoria'),
  })
}
