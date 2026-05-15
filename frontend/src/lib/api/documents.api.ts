import api from './client'
import type { Document } from '@/types'

export const documentsApi = {
  getByRental: (rentalId: string) =>
    api.get<Document[]>(`/rentals/${rentalId}/documents`).then(r => r.data),

  generateContract: (rentalId: string) =>
    api.post<Document>(`/rentals/${rentalId}/documents/contract`).then(r => r.data),

  generateReceipt: (paymentId: string) =>
    api.post<Document>(`/payments/${paymentId}/documents/receipt`).then(r => r.data),

  generateReturnProof: (returnId: string) =>
    api.post<Document>(`/returns/${returnId}/documents/proof`).then(r => r.data),

  download: async (documentId: string, filename: string): Promise<void> => {
    const response = await api.get(`/documents/${documentId}/download`, {
      responseType: 'blob',
    })
    const url = window.URL.createObjectURL(new Blob([response.data]))
    const link = window.document.createElement('a')
    link.href = url
    link.setAttribute('download', filename)
    window.document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
  },
}
