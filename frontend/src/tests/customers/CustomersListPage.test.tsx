import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CustomersListPage } from '@/features/customers/pages/CustomersListPage'
import { useCustomers } from '@/features/customers/hooks/useCustomers'
import { useAuthStore } from '@/stores/auth.store'
import type { Customer, PaginatedResponse } from '@/types'

vi.mock('@/features/customers/hooks/useCustomers', () => ({
  useCustomers: vi.fn(),
}))

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: vi.fn(),
}))

vi.mock('@/hooks/usePagination', () => ({
  usePagination: () => ({ page: 1, limit: 20, setPage: vi.fn(), reset: vi.fn() }),
}))

const mockUseCustomers = useCustomers as unknown as ReturnType<typeof vi.fn>
const mockUseAuthStore = useAuthStore as unknown as ReturnType<typeof vi.fn>

function mockAdminUser() {
  mockUseAuthStore.mockReturnValue({ user: { role: 'admin' } })
}

function renderPage() {
  return render(
    <MemoryRouter>
      <CustomersListPage />
    </MemoryRouter>,
  )
}

const mockCustomer: Customer = {
  id: '1',
  name: 'João da Silva',
  document: '12345678901',
  documentType: 'cpf',
  phone: '(11) 99999-9999',
  isActive: true,
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
}

describe('CustomersListPage', () => {
  beforeEach(() => {
    mockAdminUser()
  })

  it('shows loading skeleton while fetching', () => {
    mockUseCustomers.mockReturnValue({ isLoading: true, isError: false, data: null, refetch: vi.fn() })
    renderPage()
    // Skeletons rendered as div with animate-pulse class
    const skeletons = document.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('shows customer list on success', async () => {
    const mockData: PaginatedResponse<Customer> = {
      data: [mockCustomer],
      total: 1,
      page: 1,
      limit: 20,
    }
    mockUseCustomers.mockReturnValue({ isLoading: false, isError: false, data: mockData, refetch: vi.fn() })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('João da Silva')).toBeInTheDocument()
    })
  })

  it('shows empty state when no customers', async () => {
    const mockData: PaginatedResponse<Customer> = { data: [], total: 0, page: 1, limit: 20 }
    mockUseCustomers.mockReturnValue({ isLoading: false, isError: false, data: mockData, refetch: vi.fn() })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Nenhum cliente encontrado')).toBeInTheDocument()
    })
  })

  it('shows error state on failure', async () => {
    mockUseCustomers.mockReturnValue({ isLoading: false, isError: true, data: null, refetch: vi.fn() })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Erro')).toBeInTheDocument()
    })
  })
})
