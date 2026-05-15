import { useState } from 'react'
import { FileText, Receipt, ClipboardCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import {
  useGenerateContract,
  useGenerateReceipt,
  useGenerateReturnProof,
} from '../hooks/useDocuments'
import type { Document, DocumentType, Payment, Return, UserRole } from '@/types'

interface Props {
  rentalId: string
  role: UserRole
  payments: Payment[]
  returns: Return[]
  existingDocuments: Document[]
}

export function DocumentActions({ rentalId, role, payments, returns, existingDocuments }: Props) {
  const generateContract = useGenerateContract(rentalId)
  const generateReceipt = useGenerateReceipt(rentalId)
  const generateReturnProof = useGenerateReturnProof(rentalId)

  const [confirmOverwrite, setConfirmOverwrite] = useState<{
    type: DocumentType
    label: string
    onConfirm: () => void
  } | null>(null)

  const hasDoc = (type: DocumentType, refId?: string | null) =>
    existingDocuments.some(d => {
      if (d.type !== type) return false
      if (type === 'receipt') return d.paymentId === refId
      if (type === 'return_proof') return d.returnId === refId
      return true
    })

  const handleGenerate = (
    type: DocumentType,
    label: string,
    fn: () => void,
    refId?: string | null,
  ) => {
    if (hasDoc(type, refId)) {
      setConfirmOverwrite({ type, label, onConfirm: fn })
    } else {
      fn()
    }
  }

  const canContract = role === 'admin' || role === 'attendant'
  const canReceipt = role === 'admin' || role === 'financial'
  const canProof = role === 'admin' || role === 'attendant'

  const isPending =
    generateContract.isPending || generateReceipt.isPending || generateReturnProof.isPending

  return (
    <>
      <div className="space-y-3">
        {/* Contract */}
        {canContract && (
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() =>
                handleGenerate('contract', 'Contrato', () => generateContract.mutate(), null)
              }
            >
              {generateContract.isPending ? (
                <span className="animate-spin mr-2">⟳</span>
              ) : (
                <FileText className="mr-2 h-4 w-4" />
              )}
              Gerar Contrato
              {hasDoc('contract') && (
                <span className="ml-2 text-xs text-muted-foreground">(já existe)</span>
              )}
            </Button>
          </div>
        )}

        {/* Receipts per payment */}
        {canReceipt && payments.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Recibos de Pagamento</p>
            {payments.map(p => (
              <div key={p.id} className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={() =>
                    handleGenerate(
                      'receipt',
                      'Recibo',
                      () => generateReceipt.mutate(p.id),
                      p.id,
                    )
                  }
                >
                  {generateReceipt.isPending ? (
                    <span className="animate-spin mr-2">⟳</span>
                  ) : (
                    <Receipt className="mr-2 h-4 w-4" />
                  )}
                  Recibo — {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(p.amount))}
                  {hasDoc('receipt', p.id) && (
                    <span className="ml-2 text-xs text-muted-foreground">(já existe)</span>
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Return proofs per return */}
        {canProof && returns.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Comprovantes de Devolução</p>
            {returns.map(r => (
              <div key={r.id} className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={() =>
                    handleGenerate(
                      'return_proof',
                      'Comprovante',
                      () => generateReturnProof.mutate(r.id),
                      r.id,
                    )
                  }
                >
                  {generateReturnProof.isPending ? (
                    <span className="animate-spin mr-2">⟳</span>
                  ) : (
                    <ClipboardCheck className="mr-2 h-4 w-4" />
                  )}
                  Comprovante — {new Date(r.returnedAt).toLocaleDateString('pt-BR')}
                  {r.isPartial && (
                    <span className="ml-1 text-xs text-muted-foreground">(parcial)</span>
                  )}
                  {hasDoc('return_proof', r.id) && (
                    <span className="ml-2 text-xs text-muted-foreground">(já existe)</span>
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {confirmOverwrite && (
        <ConfirmDialog
          open={true}
          title={`Gerar novo ${confirmOverwrite.label}?`}
          description={`Já existe um ${confirmOverwrite.label.toLowerCase()} para este item. Deseja gerar um novo?`}
          confirmLabel="Sim, gerar"
          onConfirm={() => {
            confirmOverwrite.onConfirm()
            setConfirmOverwrite(null)
          }}
          onCancel={() => setConfirmOverwrite(null)}
        />
      )}
    </>
  )
}
