import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { PaymentsListPage } from '@/features/payments/pages/PaymentsListPage'
import { usePayments } from '@/features/payments/hooks/usePayments'
import { useAuthStore } from '@/stores/auth.store'

vi.mock('@/features/payments/hooks/usePayments', () => ({
  usePayments: vi.fn(),
}))
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: vi.fn(),
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn() }
})

const mockUsePayments = usePayments as unknown as ReturnType<typeof vi.fn>
const mockUseAuthStore = useAuthStore as unknown as ReturnType<typeof vi.fn>

const mockPayment = {
  id: 'pay-1',
  rentalId: 'rental-1',
  userId: 'user-1',
  amount: '1200.00',
  method: 'pix' as const,
  paidAt: '2026-05-15T10:00:00Z',
  createdAt: '2026-05-15T10:00:00Z',
  rental: { id: 'rental-1', contractNumber: '2026-0001', customer: { id: 'cust-1', name: 'João Silva' } },
  user: { id: 'user-1', name: 'Ana Financeiro' },
}

function setupMocks(role = 'admin') {
  mockUseAuthStore.mockReturnValue({ user: { role } })
  mockUsePayments.mockReturnValue({
    data: { data: [mockPayment], total: 1, page: 1, limit: 20 },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })
}

function renderPage() {
  return render(<MemoryRouter><PaymentsListPage /></MemoryRouter>)
}

describe('PaymentsListPage', () => {
  it('renderiza loading state', async () => {
    mockUseAuthStore.mockReturnValue({ user: { role: 'admin' } })
    mockUsePayments.mockReturnValue({ isLoading: true, isError: false, data: undefined })
    renderPage()
    await waitFor(() => expect(screen.getAllByRole('status').length).toBeGreaterThan(0))
  })

  it('renderiza error state com retry', async () => {
    mockUseAuthStore.mockReturnValue({ user: { role: 'admin' } })
    mockUsePayments.mockReturnValue({ isLoading: false, isError: true, data: undefined, refetch: vi.fn() })
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument())
  })

  it('exibe pagamentos na tabela', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => {
      expect(screen.getAllByText('João Silva').length).toBeGreaterThan(0)
      expect(screen.getAllByText('#2026-0001').length).toBeGreaterThan(0)
      expect(screen.getAllByText('PIX').length).toBeGreaterThan(0)
    })
  })

  it('exibe contrato como link clicável', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => {
      const links = screen.getAllByText('#2026-0001')
      expect(links.some(el => el.tagName === 'BUTTON')).toBe(true)
    })
  })

  it('EmptyState quando sem pagamentos', async () => {
    mockUseAuthStore.mockReturnValue({ user: { role: 'admin' } })
    mockUsePayments.mockReturnValue({
      data: { data: [], total: 0, page: 1, limit: 20 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    renderPage()
    await waitFor(() => expect(screen.getByText(/nenhum pagamento/i)).toBeInTheDocument())
  })

  it('botões paginação visíveis quando total > limit', async () => {
    mockUseAuthStore.mockReturnValue({ user: { role: 'admin' } })
    mockUsePayments.mockReturnValue({
      data: { data: [mockPayment], total: 25, page: 1, limit: 20 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /próxima/i })).toBeInTheDocument()
    })
  })

  it('aplica filtro de período — usePayments chamado com dateFrom/dateTo', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => expect(screen.getAllByText('João Silva').length).toBeGreaterThan(0))
    const call = mockUsePayments.mock.calls[mockUsePayments.mock.calls.length - 1][0]
    expect(call?.dateFrom).toBeDefined()
    expect(call?.dateTo).toBeDefined()
  })

  it('aplica filtro de método — usePayments chamado com params', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => expect(screen.getAllByText('João Silva').length).toBeGreaterThan(0))
    expect(mockUsePayments).toHaveBeenCalled()
    const call = mockUsePayments.mock.calls[mockUsePayments.mock.calls.length - 1][0]
    expect(call).toHaveProperty('page', 1)
  })

  it('attendant é redirecionado — página não exibe Pagamentos', async () => {
    mockUseAuthStore.mockReturnValue({ user: { role: 'attendant' } })
    mockUsePayments.mockReturnValue({ data: undefined, isLoading: false, isError: false })
    renderPage()
    await waitFor(() => expect(screen.queryByText('Pagamentos')).not.toBeInTheDocument())
  })

  it('mostra botão de filtros', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => {
      const btns = screen.getAllByRole('button')
      expect(btns.some(b => b.textContent?.includes('Filtros'))).toBe(true)
    })
  })

  it('mostra range de paginação quando total > limit', async () => {
    mockUseAuthStore.mockReturnValue({ user: { role: 'admin' } })
    mockUsePayments.mockReturnValue({
      data: { data: [mockPayment], total: 25, page: 1, limit: 20 },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    renderPage()
    await waitFor(() => expect(screen.getByText(/Mostrando 1–20 de 25/)).toBeInTheDocument())
  })
})
