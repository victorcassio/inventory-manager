import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { RentalDetailPage } from '@/features/rentals/pages/RentalDetailPage'
import { useRental, useCancelRental } from '@/features/rentals/hooks/useRentals'
import { useReturnsByRental } from '@/features/returns/hooks/useReturns'
import { usePaymentsByRental } from '@/features/payments/hooks/usePayments'
import { useAuthStore } from '@/stores/auth.store'

vi.mock('@/features/rentals/hooks/useRentals', () => ({
  useRental: vi.fn(),
  useCancelRental: vi.fn(),
}))

vi.mock('@/features/returns/hooks/useReturns', () => ({
  useReturnsByRental: vi.fn(),
}))

vi.mock('@/features/payments/hooks/usePayments', () => ({
  usePaymentsByRental: vi.fn(),
}))

vi.mock('@/features/documents/hooks/useDocuments', () => ({
  useDocumentsByRental: vi.fn().mockReturnValue({ data: [] }),
  useGenerateContract: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useGenerateReceipt: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useGenerateReturnProof: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useDownloadDocument: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: vi.fn(),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useParams: () => ({ id: 'rental-1' }),
    useNavigate: () => vi.fn(),
  }
})

const mockUseRental = useRental as unknown as ReturnType<typeof vi.fn>
const mockUseCancelRental = useCancelRental as unknown as ReturnType<typeof vi.fn>
const mockUseReturnsByRental = useReturnsByRental as unknown as ReturnType<typeof vi.fn>
const mockUsePaymentsByRental = usePaymentsByRental as unknown as ReturnType<typeof vi.fn>
const mockUseAuthStore = useAuthStore as unknown as ReturnType<typeof vi.fn>

const mockRental = {
  id: 'rental-1',
  contractNumber: '2026-0001',
  status: 'active',
  computedStatus: 'active',
  daysOverdue: 0,
  customerId: 'cust-1',
  customer: { id: 'cust-1', name: 'Acme LTDA', document: '12345678000195' },
  rentalItems: [
    {
      id: 'ri-1',
      rentalId: 'rental-1',
      itemId: 'item-1',
      quantity: 3,
      unitPrice: '15.00',
      returnedQty: 0,
      item: { id: 'item-1', name: 'Andaime 1m', code: 'AND-001', dailyRate: '15.00' },
    },
  ],
  startedAt: '2026-05-01',
  expectedReturn: '2026-05-08',
  deposit: '0',
  discount: '0',
  lateFee: '0',
  extraCosts: '0',
  paidAmount: '0',
  total: '105',
  subtotal: '105',
  balanceAmount: 105,
  userId: 'user-1',
  pricingType: 'daily',
  createdAt: '2026-05-01',
  updatedAt: '2026-05-01',
}

const mockReturn = {
  id: 'ret-1',
  rentalId: 'rental-1',
  userId: 'user-1',
  returnedAt: '2026-05-08T12:00:00Z',
  isPartial: false,
  lateDays: 0,
  lateFee: '0',
  createdAt: '2026-05-08T12:00:00Z',
  returnItems: [],
}

const mockPayment = {
  id: 'pay-1',
  rentalId: 'rental-1',
  userId: 'user-1',
  amount: '50.00',
  method: 'pix' as const,
  paidAt: '2026-05-08T12:00:00Z',
  createdAt: '2026-05-08T12:00:00Z',
}

function setupMocks(role: string, overrideRental = {}) {
  mockUseAuthStore.mockReturnValue({ user: { role } })
  mockUseRental.mockReturnValue({
    data: { ...mockRental, ...overrideRental },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })
  mockUseCancelRental.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  mockUseReturnsByRental.mockReturnValue({ data: [mockReturn] })
  mockUsePaymentsByRental.mockReturnValue({ data: [mockPayment] })
}

function renderPage() {
  return render(<MemoryRouter><RentalDetailPage /></MemoryRouter>)
}

describe('RentalDetailPage', () => {
  it('exibe seção de devoluções', async () => {
    setupMocks('admin')
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/Devoluções \(1\)/)).toBeInTheDocument()
    })
  })

  it('exibe seção de pagamentos', async () => {
    setupMocks('admin')
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/Pagamentos \(1\)/)).toBeInTheDocument()
    })
  })

  it('botão Registrar Devolução aparece para attendant com rental active', async () => {
    setupMocks('attendant')
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /registrar devolução/i })).toBeInTheDocument()
    })
  })

  it('botão Registrar Pagamento aparece para financial com balance > 0', async () => {
    setupMocks('financial')
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /registrar pagamento/i })).toBeInTheDocument()
    })
  })

  it('botão Registrar Devolução oculto para financial', async () => {
    setupMocks('financial')
    renderPage()
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /registrar devolução/i })).not.toBeInTheDocument()
    })
  })

  it('botão Registrar Pagamento oculto para attendant', async () => {
    setupMocks('attendant')
    renderPage()
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /registrar pagamento/i })).not.toBeInTheDocument()
    })
  })

  it('admin vê ambos os botões (Devolução e Pagamento)', async () => {
    setupMocks('admin')
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /registrar devolução/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /registrar pagamento/i })).toBeInTheDocument()
    })
  })

  it('admin vê botão cancelar locação para status active', async () => {
    setupMocks('admin')
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /cancelar locação/i })).toBeInTheDocument()
    })
  })

  it('attendant não vê botão cancelar locação', async () => {
    setupMocks('attendant')
    renderPage()
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /cancelar locação/i })).not.toBeInTheDocument()
    })
  })

  it('botão Registrar Devolução oculto para rental cancelado', async () => {
    setupMocks('admin', { status: 'canceled', computedStatus: 'canceled' })
    renderPage()
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /registrar devolução/i })).not.toBeInTheDocument()
    })
  })

  it('mostra pagamentos na tabela', async () => {
    setupMocks('admin')
    renderPage()
    await waitFor(() => {
      expect(screen.getAllByText('PIX').length).toBeGreaterThan(0)
    })
  })

  it('mostra mensagem quando sem devoluções', async () => {
    setupMocks('admin')
    mockUseReturnsByRental.mockReturnValue({ data: [] })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/nenhuma devolução registrada/i)).toBeInTheDocument()
    })
  })
})
