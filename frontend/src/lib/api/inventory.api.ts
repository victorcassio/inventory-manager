import api from './client'
import type { Item, ItemCategory, PaginatedResponse } from '@/types'

export const inventoryApi = {
  listCategories: () => api.get<ItemCategory[]>('/inventory/categories').then(r => r.data),
  createCategory: (data: unknown) => api.post<ItemCategory>('/inventory/categories', data).then(r => r.data),
  updateCategory: (id: string, data: unknown) => api.patch<ItemCategory>(`/inventory/categories/${id}`, data).then(r => r.data),
  listItems: (params?: { page?: number; limit?: number; categoryId?: string; availableOnly?: boolean }) =>
    api.get<PaginatedResponse<Item>>('/inventory/items', { params }).then(r => r.data),
  getItem: (id: string) => api.get<Item>(`/inventory/items/${id}`).then(r => r.data),
  createItem: (data: unknown) => api.post<Item>('/inventory/items', data).then(r => r.data),
  updateItem: (id: string, data: unknown) => api.patch<Item>(`/inventory/items/${id}`, data).then(r => r.data),
}
