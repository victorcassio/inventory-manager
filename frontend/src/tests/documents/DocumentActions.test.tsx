import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DocumentActions } from '@/features/documents/components/DocumentActions'
import {
  useGenerateContract,
  useGenerateReceipt,
  useGenerateReturnProof,
} from '@/features/documents/hooks/useDocuments'
import type { UserRole } from '@/types'

vi.mock('@/features/documents/hooks/useDocuments', () => ({
  useGenerateContract: vi.fn(),
  useGenerateReceipt: vi.fn(),
  useGenerateReturnProof: vi.fn(),
}))

const mockContract = useGenerateContract as ReturnType<typeof vi.fn>
const mockReceipt = useGenerateReceipt as ReturnType<typeof vi.fn>
const mockProof = useGenerateReturnProof as ReturnType<typeof vi.fn>

function renderActions(role: UserRole) {
  mockContract.mockReturnValue({ mutate: vi.fn(), isPending: false })
  mockReceipt.mockReturnValue({ mutate: vi.fn(), isPending: false })
  mockProof.mockReturnValue({ mutate: vi.fn(), isPending: false })

  return render(
    <MemoryRouter>
      <DocumentActions
        rentalId="rental-1"
        role={role}
        payments={[{ id: 'pay-1', rentalId: 'rental-1', userId: 'u1', amount: '100', method: 'pix', paidAt: '2026-05-15', createdAt: '2026-05-15' }]}
        returns={[{ id: 'ret-1', rentalId: 'rental-1', userId: 'u1', returnedAt: '2026-05-15', isPartial: false, lateDays: 0, lateFee: '0', createdAt: '2026-05-15' }]}
        existingDocuments={[]}
      />
    </MemoryRouter>,
  )
}

describe('DocumentActions', () => {
  it('shows Gerar Contrato button for admin', () => {
    renderActions('admin')
    expect(screen.getByRole('button', { name: /gerar contrato/i })).toBeInTheDocument()
  })

  it('shows Gerar Contrato button for attendant', () => {
    renderActions('attendant')
    expect(screen.getByRole('button', { name: /gerar contrato/i })).toBeInTheDocument()
  })

  it('does not show Gerar Contrato for financial', () => {
    renderActions('financial')
    expect(screen.queryByRole('button', { name: /gerar contrato/i })).not.toBeInTheDocument()
  })

  it('shows Recibo button for financial', () => {
    renderActions('financial')
    expect(screen.getByRole('button', { name: /recibo/i })).toBeInTheDocument()
  })

  it('does not show Recibo button for attendant', () => {
    renderActions('attendant')
    expect(screen.queryByRole('button', { name: /recibo/i })).not.toBeInTheDocument()
  })

  it('shows Comprovante button for attendant', () => {
    renderActions('attendant')
    expect(screen.getByRole('button', { name: /comprovante/i })).toBeInTheDocument()
  })

  it('does not show Comprovante button for financial', () => {
    renderActions('financial')
    expect(screen.queryByRole('button', { name: /comprovante/i })).not.toBeInTheDocument()
  })
})
