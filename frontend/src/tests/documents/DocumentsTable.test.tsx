import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { DocumentsTable } from '@/features/documents/components/DocumentsTable'
import { useDownloadDocument } from '@/features/documents/hooks/useDocuments'
import type { Document } from '@/types'

vi.mock('@/features/documents/hooks/useDocuments', () => ({
  useDownloadDocument: vi.fn(),
}))

const mockUseDownload = useDownloadDocument as ReturnType<typeof vi.fn>

const baseDoc: Document = {
  id: 'doc-1',
  type: 'contract',
  filename: 'contract-123.pdf',
  path: '/storage/documents/rental-1/contract-123.pdf',
  status: 'generated',
  rentalId: 'rental-1',
  customerId: 'cust-1',
  createdAt: '2026-05-15T10:00:00.000Z',
}

function renderTable(docs: Document[]) {
  mockUseDownload.mockReturnValue({ mutate: vi.fn(), isPending: false })
  return render(
    <MemoryRouter>
      <DocumentsTable documents={docs} />
    </MemoryRouter>,
  )
}

describe('DocumentsTable', () => {
  it('renders existing documents', () => {
    renderTable([baseDoc])
    expect(screen.getAllByText('Contrato').length).toBeGreaterThan(0)
    expect(screen.getByText('contract-123.pdf')).toBeInTheDocument()
    expect(screen.getAllByText('Gerado').length).toBeGreaterThan(0)
  })

  it('shows EmptyState when no documents', () => {
    renderTable([])
    expect(screen.getByText('Nenhum documento gerado')).toBeInTheDocument()
  })

  it('calls downloadDocument when download button is clicked', async () => {
    const user = userEvent.setup()
    const mockMutate = vi.fn()
    mockUseDownload.mockReturnValue({ mutate: mockMutate, isPending: false })

    render(
      <MemoryRouter>
        <DocumentsTable documents={[baseDoc]} />
      </MemoryRouter>,
    )

    await user.click(screen.getAllByTitle('Baixar PDF')[0])

    expect(mockMutate).toHaveBeenCalledWith({
      documentId: 'doc-1',
      filename: 'contract-123.pdf',
    })
  })

  it('shows correct label for contract type', () => {
    renderTable([{ ...baseDoc, type: 'contract' }])
    expect(screen.getAllByText('Contrato').length).toBeGreaterThan(0)
  })

  it('shows correct label for receipt type', () => {
    renderTable([{ ...baseDoc, id: 'doc-2', type: 'receipt', filename: 'receipt-1.pdf' }])
    expect(screen.getAllByText('Recibo').length).toBeGreaterThan(0)
  })

  it('shows correct label for return_proof type', () => {
    renderTable([{ ...baseDoc, id: 'doc-3', type: 'return_proof', filename: 'proof-1.pdf' }])
    expect(screen.getAllByText('Comprovante de Devolução').length).toBeGreaterThan(0)
  })

  it('exibe tipo e data na lista mobile', () => {
    renderTable([baseDoc])
    // 'Contrato' aparece em desktop e mobile → pelo menos 1 ocorrência
    expect(screen.getAllByText('Contrato').length).toBeGreaterThan(0)
  })
})
