import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { documentsApi } from '@/lib/api/documents.api'
import type { AxiosError } from 'axios'

export const documentKeys = {
  all: ['documents'] as const,
  list: (params?: object) => [...documentKeys.all, 'list', params] as const,
  byRental: (rentalId: string) => [...documentKeys.all, 'rental', rentalId] as const,
}

export function useDocuments(params?: {
  type?: string
  status?: string
  rentalId?: string
  dateFrom?: string
  dateTo?: string
  page?: number
  limit?: number
}) {
  return useQuery({
    queryKey: documentKeys.list(params),
    queryFn: () => documentsApi.list(params),
  })
}

export function useDocumentsByRental(rentalId: string) {
  return useQuery({
    queryKey: documentKeys.byRental(rentalId),
    queryFn: () => documentsApi.getByRental(rentalId),
    enabled: !!rentalId,
  })
}

export function useGenerateContract(rentalId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => documentsApi.generateContract(rentalId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: documentKeys.byRental(rentalId) })
      toast.success('Contrato gerado com sucesso')
    },
    onError: (error: AxiosError<{ message?: string }>) => {
      toast.error(error.response?.data?.message ?? 'Erro ao gerar contrato')
    },
  })
}

export function useGenerateReceipt(rentalId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (paymentId: string) => documentsApi.generateReceipt(paymentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: documentKeys.byRental(rentalId) })
      toast.success('Recibo gerado com sucesso')
    },
    onError: (error: AxiosError<{ message?: string }>) => {
      toast.error(error.response?.data?.message ?? 'Erro ao gerar recibo')
    },
  })
}

export function useGenerateReturnProof(rentalId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (returnId: string) => documentsApi.generateReturnProof(returnId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: documentKeys.byRental(rentalId) })
      toast.success('Comprovante gerado com sucesso')
    },
    onError: (error: AxiosError<{ message?: string }>) => {
      toast.error(error.response?.data?.message ?? 'Erro ao gerar comprovante')
    },
  })
}

export function useDownloadDocument() {
  return useMutation({
    mutationFn: ({ documentId, filename }: { documentId: string; filename: string }) =>
      documentsApi.download(documentId, filename),
    onSuccess: () => {
      toast.success('Download iniciado')
    },
    onError: (error: AxiosError<{ message?: string }>) => {
      const msg = error.response?.status === 404
        ? 'Arquivo não encontrado no servidor'
        : (error.response?.data?.message ?? 'Erro ao baixar documento')
      toast.error(msg)
    },
  })
}
