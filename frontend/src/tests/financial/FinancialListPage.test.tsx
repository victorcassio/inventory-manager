import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { FinancialListPage } from '@/features/financial/pages/FinancialListPage'
import { useFinancialTransactions } from '@/features/financial/hooks/useFinancialTransactions'
import { useFinancialSummary } from '@/features/financial/hooks/useFinancialSummary'
import { useAuthStore } from '@/stores/auth.store'

vi.mock('@/features/financial/hooks/useFinancialTransactions', () => ({
  useFinancialTransactions: vi.fn(),
}))
vi.mock('@/features/financial/hooks/useFinancialSummary', () => ({
  useFinancialSummary: vi.fn(),
}))
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: vi.fn(),
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn() }
})

const mockUseFinancialTransactions = useFinancialTransactions as unknown as ReturnType<typeof vi.fn>
const mockUseFinancialSummary      = useFinancialSummary      as unknown as ReturnType<typeof vi.fn>
const mockUseAuthStore             = useAuthStore             as unknown as ReturnType<typeof vi.fn>

const mockTransaction = {
  id: 'txn-1',
  type: 'income',
  category: 'rental_income',
  origin: 'payment',
  amount: '1200.00',
  description: 'Pagamento contrato 2026-0042',
  date: '2026-05-15',
  isVoided: false,
  userId: 'user-1',
  user: { id: 'user-1', name: 'João', email: 'joao@test.com' },
  rental: { id: 'rental-1', contractNumber: '2026-0042' },
  payment: null,
  createdAt: '2026-05-15T10:00:00Z',
  updatedAt: '2026-05-15T10:00:00Z',
}

function setupMocks(role = 'admin') {
  mockUseAuthStore.mockReturnValue({ user: { role } })
  mockUseFinancialTransactions.mockReturnValue({
    data: { data: [mockTransaction], total: 1, page: 1, limit: 20 },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })
  mockUseFinancialSummary.mockReturnValue({
    data: { totalIncome: 1200, totalExpense: 350, balance: 850, voidedCount: 2 },
    isLoading: false,
    isError: false,
  })
}

function renderPage() {
  return render(<MemoryRouter><FinancialListPage /></MemoryRouter>)
}

describe('FinancialListPage', () => {
  it('exibe título da página', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => expect(screen.getByText('Financeiro')).toBeInTheDocument())
  })

  it('exibe os 4 cards de resumo', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('ENTRADAS')).toBeInTheDocument()
      expect(screen.getByText('SAÍDAS')).toBeInTheDocument()
      expect(screen.getByText('SALDO')).toBeInTheDocument()
      expect(screen.getByText('ANULADOS')).toBeInTheDocument()
    })
  })

  it('exibe transações na tabela', async () => {
    setupMocks()
    renderPage()
    await waitFor(() =>
      expect(screen.getByText('Pagamento contrato 2026-0042')).toBeInTheDocument(),
    )
  })

  it('botão Novo Lançamento visível para admin', async () => {
    setupMocks('admin')
    renderPage()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /novo lançamento/i })).toBeInTheDocument(),
    )
  })

  it('botão Novo Lançamento visível para financial', async () => {
    setupMocks('financial')
    renderPage()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /novo lançamento/i })).toBeInTheDocument(),
    )
  })

  it('exibe badge anulado para transação anulada', async () => {
    mockUseAuthStore.mockReturnValue({ user: { role: 'admin' } })
    mockUseFinancialTransactions.mockReturnValue({
      data: {
        data: [{ ...mockTransaction, isVoided: true }],
        total: 1, page: 1, limit: 20,
      },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    mockUseFinancialSummary.mockReturnValue({
      data: { totalIncome: 0, totalExpense: 0, balance: 0, voidedCount: 1 },
      isLoading: false, isError: false,
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('anulado')).toBeInTheDocument())
  })
})
