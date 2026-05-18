import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { DocumentsListPage } from '@/features/documents/pages/DocumentsListPage'
import { useDocuments, useDownloadDocument } from '@/features/documents/hooks/useDocuments'

vi.mock('@/features/documents/hooks/useDocuments', () => ({
  useDocuments: vi.fn(),
  useDownloadDocument: vi.fn(),
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn() }
})
vi.mock('@/lib/api/rentals.api', () => ({
  rentalsApi: {
    list: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  },
}))

const mockUseDocuments = useDocuments as unknown as ReturnType<typeof vi.fn>
const mockUseDownload = useDownloadDocument as unknown as ReturnType<typeof vi.fn>

const mockDoc = {
  id: 'doc-1',
  type: 'contract' as const,
  filename: 'contract-123.pdf',
  path: '/storage/documents/rental-1/contract-123.pdf',
  status: 'generated' as const,
  rentalId: 'rental-1',
  customerId: 'cust-1',
  createdAt: '2026-05-15T10:00:00Z',
  rental: { id: 'rental-1', contractNumber: '2026-0001', customer: { id: 'cust-1', name: 'Acme Corp' } },
}

function setupMocks() {
  mockUseDownload.mockReturnValue({ mutate: vi.fn(), isPending: false })
  mockUseDocuments.mockReturnValue({
    data: { data: [mockDoc], total: 1, page: 1, limit: 20 },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })
}

function renderPage() {
  return render(<MemoryRouter><DocumentsListPage /></MemoryRouter>)
}

describe('DocumentsListPage', () => {
  it('renderiza lista de documentos', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument()
      expect(screen.getByText('#2026-0001')).toBeInTheDocument()
      expect(screen.getByText('contract-123.pdf')).toBeInTheDocument()
      expect(screen.getAllByText('Contrato').length).toBeGreaterThan(0)
    })
  })

  it('mostra EmptyState quando vazio', async () => {
    mockUseDownload.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mockUseDocuments.mockReturnValue({
      data: { data: [], total: 0, page: 1, limit: 20 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    renderPage()
    await waitFor(() => expect(screen.getByText(/nenhum documento encontrado/i)).toBeInTheDocument())
  })

  it('renderiza loading state (skeletons)', async () => {
    mockUseDownload.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mockUseDocuments.mockReturnValue({ isLoading: true, isError: false, data: undefined })
    renderPage()
    await waitFor(() => expect(screen.getAllByRole('status').length).toBeGreaterThan(0))
  })

  it('renderiza error state com botão retry', async () => {
    mockUseDownload.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mockUseDocuments.mockReturnValue({ isLoading: false, isError: true, data: undefined, refetch: vi.fn() })
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument())
  })

  it('exibe contrato como link clicável para /rentals/:id', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => {
      const link = screen.getByText('#2026-0001')
      expect(link.tagName).toBe('BUTTON')
    })
  })

  it('botão download chama useDownloadDocument.mutate', async () => {
    const user = userEvent.setup()
    const mockMutate = vi.fn()
    mockUseDownload.mockReturnValue({ mutate: mockMutate, isPending: false })
    mockUseDocuments.mockReturnValue({
      data: { data: [mockDoc], total: 1, page: 1, limit: 20 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    renderPage()
    await waitFor(() => screen.getByTitle('Baixar PDF'))
    await user.click(screen.getByTitle('Baixar PDF'))
    expect(mockMutate).toHaveBeenCalledWith({ documentId: 'doc-1', filename: 'contract-123.pdf' })
  })

  it('passa filtros de período no render inicial e sem filtro de tipo', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => screen.getByText('Acme Corp'))
    const call = mockUseDocuments.mock.calls[mockUseDocuments.mock.calls.length - 1][0]
    expect(call?.dateFrom).toBeDefined()
    expect(call?.dateTo).toBeDefined()
    expect(call?.type).toBeUndefined()
    expect(call?.status).toBeUndefined()
  })

  it('preset Hoje chama useDocuments com dateFrom igual a dateTo', async () => {
    const user = userEvent.setup()
    setupMocks()
    renderPage()
    await waitFor(() => screen.getByText('Acme Corp'))

    await user.click(screen.getByRole('button', { name: 'Hoje' }))

    await waitFor(() => {
      const calls = mockUseDocuments.mock.calls
      const lastCall = calls[calls.length - 1][0]
      expect(lastCall?.dateFrom).toBeDefined()
      expect(lastCall?.dateTo).toBeDefined()
      expect(lastCall?.dateFrom).toBe(lastCall?.dateTo)
    })
  })

  it('exibe paginação quando total > limit', async () => {
    mockUseDownload.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mockUseDocuments.mockReturnValue({
      data: { data: [mockDoc], total: 25, page: 1, limit: 20 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /próxima/i })).toBeInTheDocument())
  })
})
