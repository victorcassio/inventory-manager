// src/features/documents/components/DocumentsTable.tsx
import { Download, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/feedback/EmptyState'
import { useDownloadDocument } from '../hooks/useDocuments'
import { formatDate } from '@/lib/formatters'
import type { Document, DocumentType } from '@/types'

const TYPE_LABEL: Record<DocumentType, string> = {
  contract: 'Contrato', receipt: 'Recibo', return_proof: 'Comprovante de Devolução',
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  generated: 'default', voided: 'outline',
}

interface Props { documents: Document[] }

export function DocumentsTable({ documents }: Props) {
  const download = useDownloadDocument()

  if (documents.length === 0) {
    return (
      <EmptyState
        title="Nenhum documento gerado"
        description="Gere contratos, recibos ou comprovantes de devolução abaixo."
      />
    )
  }

  return (
    <>
      {/* Desktop */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tipo</TableHead>
              <TableHead>Arquivo</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Gerado em</TableHead>
              <TableHead className="w-20">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {documents.map(doc => (
              <TableRow key={doc.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    {TYPE_LABEL[doc.type] ?? doc.type}
                  </div>
                </TableCell>
                <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                  {doc.filename}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[doc.status] ?? 'secondary'}>
                    {doc.status === 'generated' ? 'Gerado' : 'Cancelado'}
                  </Badge>
                </TableCell>
                <TableCell>{formatDate(doc.createdAt)}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon"
                    disabled={download.isPending || doc.status === 'voided'}
                    onClick={() => download.mutate({ documentId: doc.id, filename: doc.filename })}
                    title="Baixar PDF">
                    <Download className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile */}
      <div className="md:hidden divide-y rounded-md border">
        {documents.map(doc => (
          <div key={doc.id} className="flex items-center gap-3 p-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{TYPE_LABEL[doc.type] ?? doc.type}</p>
              <p className="text-xs text-muted-foreground">{formatDate(doc.createdAt)}</p>
            </div>
            <Badge variant={STATUS_VARIANT[doc.status] ?? 'secondary'}>
              {doc.status === 'generated' ? 'Gerado' : 'Cancelado'}
            </Badge>
            <Button variant="ghost" size="icon" className="shrink-0"
              disabled={download.isPending || doc.status === 'voided'}
              onClick={() => download.mutate({ documentId: doc.id, filename: doc.filename })}
              title="Baixar PDF">
              <Download className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </>
  )
}
