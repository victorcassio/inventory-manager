import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { FinancialDetailPage } from '@/features/financial/pages/FinancialDetailPage'
import { useFinancialTransaction } from '@/features/financial/hooks/useFinancialTransaction'
import { useVoidTransaction } from '@/features/financial/hooks/useVoidTransaction'
import { useAuthStore } from '@/stores/auth.store'

vi.mock('@/features/financial/hooks/useFinancialTransaction', () => ({
  useFinancialTransaction: vi.fn(),
}))
vi.mock('@/features/financial/hooks/useVoidTransaction', () => ({
  useVoidTransaction: vi.fn(),
}))
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: vi.fn(),
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useParams: () => ({ id: 'txn-1' }), useNavigate: () => vi.fn() }
})

const mockUseFinancialTransaction = useFinancialTransaction as unknown as ReturnType<typeof vi.fn>
const mockUseVoidTransaction      = useVoidTransaction      as unknown as ReturnType<typeof vi.fn>
const mockUseAuthStore            = useAuthStore            as unknown as ReturnType<typeof vi.fn>

const baseTxn = {
  id: 'txn-1',
  type: 'expense',
  category: 'maintenance',
  origin: 'manual',
  amount: '350.00',
  description: 'Manutenção andaimes lote A',
  date: '2026-05-14',
  isVoided: false,
  userId: 'user-1',
  user: { id: 'user-1', name: 'João Silva', email: 'joao@test.com' },
  rental: null,
  payment: null,
  createdAt: '2026-05-14T09:00:00Z',
  updatedAt: '2026-05-14T09:00:00Z',
}

function setupMocks(role = 'admin', txnOverride = {}) {
  mockUseAuthStore.mockReturnValue({ user: { role } })
  mockUseFinancialTransaction.mockReturnValue({
    data: { ...baseTxn, ...txnOverride },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })
  mockUseVoidTransaction.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
}

function renderPage() {
  return render(<MemoryRouter><FinancialDetailPage /></MemoryRouter>)
}

describe('FinancialDetailPage', () => {
  it('exibe a descrição do lançamento', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => expect(screen.getByText('Manutenção andaimes lote A')).toBeInTheDocument())
  })

  it('admin vê botão Editar em lançamento manual ativo', async () => {
    setupMocks('admin')
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /editar/i })).toBeInTheDocument())
  })

  it('admin vê botão Anular em lançamento manual ativo', async () => {
    setupMocks('admin')
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /anular/i })).toBeInTheDocument())
  })

  it('financial vê botão Editar mas NÃO vê Anular', async () => {
    setupMocks('financial')
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /editar/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /anular/i })).not.toBeInTheDocument()
    })
  })

  it('oculta Editar e Anular quando origin = payment', async () => {
    setupMocks('admin', { origin: 'payment' })
    renderPage()
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /editar/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /anular/i })).not.toBeInTheDocument()
      expect(screen.getByText(/somente leitura/i)).toBeInTheDocument()
    })
  })

  it('exibe banner de anulação quando isVoided = true', async () => {
    setupMocks('admin', {
      isVoided: true,
      voidReason: 'Lançamento duplicado',
      voidedAt: '2026-05-13T14:00:00Z',
    })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/lançamento anulado/i)).toBeInTheDocument()
      expect(screen.getByText('Lançamento duplicado')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /editar/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /anular/i })).not.toBeInTheDocument()
    })
  })

  it('exibe link para locação quando rentalId presente', async () => {
    setupMocks('admin', {
      rentalId: 'rental-1',
      rental: { id: 'rental-1', contractNumber: '2026-0042' },
    })
    renderPage()
    await waitFor(() => expect(screen.getByText(/2026-0042/)).toBeInTheDocument())
  })
})
