import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RentalDetailPage } from '@/features/rentals/pages/RentalDetailPage'
import { useRental, useCancelRental } from '@/features/rentals/hooks/useRentals'
import { useReturnsByRental } from '@/features/returns/hooks/useReturns'
import { usePaymentsByRental } from '@/features/payments/hooks/usePayments'
import { useDocumentsByRental } from '@/features/documents/hooks/useDocuments'
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
  useDocumentsByRental: vi.fn(),
  useGenerateContract: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useGenerateReceipt: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useGenerateReturnProof: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useDownloadDocument: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: vi.fn(),
}))

const mockUseRental = useRental as unknown as ReturnType<typeof vi.fn>
const mockUseCancelRental = useCancelRental as unknown as ReturnType<typeof vi.fn>
const mockUseReturns = useReturnsByRental as unknown as ReturnType<typeof vi.fn>
const mockUsePayments = usePaymentsByRental as unknown as ReturnType<typeof vi.fn>
const mockUseDocuments = useDocumentsByRental as unknown as ReturnType<typeof vi.fn>
const mockUseAuthStore = useAuthStore as unknown as ReturnType<typeof vi.fn>

const baseRental = {
  id: 'rental-1',
  contractNumber: '2026-0001',
  status: 'active',
  computedStatus: 'active',
  daysOverdue: 0,
  customerId: 'cust-1',
  customer: { id: 'cust-1', name: 'Acme', document: '12345678000195' },
  rentalItems: [],
  startedAt: '2026-05-01',
  expectedReturn: '2026-05-08',
  deposit: '0',
  discount: '0',
  lateFee: '0',
  extraCosts: '0',
  paidAmount: '0',
  total: '300',
  subtotal: '300',
  balanceAmount: 300,
}

function renderPage(role: 'admin' | 'attendant' | 'financial') {
  mockUseRental.mockReturnValue({ data: baseRental, isLoading: false, isError: false, refetch: vi.fn() })
  mockUseCancelRental.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  mockUseReturns.mockReturnValue({ data: [] })
  mockUsePayments.mockReturnValue({ data: [] })
  mockUseDocuments.mockReturnValue({ data: [] })
  mockUseAuthStore.mockReturnValue({ user: { id: 'u1', name: 'Test', role, email: 'test@test.com', isActive: true, createdAt: '' } })

  return render(
    <MemoryRouter initialEntries={['/rentals/rental-1']}>
      <Routes>
        <Route path="/rentals/:id" element={<RentalDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RentalDetailPage — Documents section', () => {
  it('exibe a seção Documentos', () => {
    renderPage('admin')
    expect(screen.getByText(/Documentos \(0\)/i)).toBeInTheDocument()
  })

  it('exibe EmptyState quando não há documentos', () => {
    renderPage('admin')
    expect(screen.getByText('Nenhum documento gerado')).toBeInTheDocument()
  })

  it('botão Gerar Contrato aparece para admin', () => {
    renderPage('admin')
    expect(screen.getByRole('button', { name: /gerar contrato/i })).toBeInTheDocument()
  })

  it('botão Gerar Contrato aparece para attendant', () => {
    renderPage('attendant')
    expect(screen.getByRole('button', { name: /gerar contrato/i })).toBeInTheDocument()
  })

  it('botão Gerar Contrato não aparece para financial', () => {
    renderPage('financial')
    expect(screen.queryByRole('button', { name: /gerar contrato/i })).not.toBeInTheDocument()
  })
})
