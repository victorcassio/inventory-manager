// src/tests/rentals/RentalsListPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { RentalsListPage } from '@/features/rentals/pages/RentalsListPage'
import { useRentals } from '@/features/rentals/hooks/useRentals'
import { useAuthStore } from '@/stores/auth.store'
import type { PaginatedResponse } from '@/types'

vi.mock('@/features/rentals/hooks/useRentals', () => ({ useRentals: vi.fn() }))
vi.mock('@/stores/auth.store', () => ({ useAuthStore: vi.fn() }))
vi.mock('@/hooks/usePagination', () => ({
  usePagination: () => ({ page: 1, limit: 20, setPage: vi.fn() }),
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn(), useSearchParams: () => [new URLSearchParams()] }
})

const mockUseRentals = useRentals as unknown as ReturnType<typeof vi.fn>
const mockUseAuthStore = useAuthStore as unknown as ReturnType<typeof vi.fn>

const mockRental = {
  id: 'r1',
  contractNumber: '2026-0001',
  startedAt: '2026-05-01T00:00:00Z',
  expectedReturn: '2026-05-11T00:00:00Z',
  computedStatus: 'active',
  total: '280.00',
  customer: { id: 'c1', name: 'João Silva' },
}

function setupMocks() {
  mockUseAuthStore.mockReturnValue({ user: { role: 'admin' } })
  mockUseRentals.mockReturnValue({
    data: { data: [mockRental], total: 1, page: 1, limit: 20 } as PaginatedResponse<typeof mockRental>,
    isLoading: false, isError: false, refetch: vi.fn(),
  })
}

function renderPage() {
  return render(<MemoryRouter><RentalsListPage /></MemoryRouter>)
}

describe('RentalsListPage', () => {
  it('exibe nome do cliente na lista', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => expect(screen.getAllByText('João Silva').length).toBeGreaterThan(0))
  })

  it('exibe contrato na lista', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => expect(screen.getAllByText(/2026-0001/).length).toBeGreaterThan(0))
  })

  it('mostra paginação quando total > limit', async () => {
    mockUseAuthStore.mockReturnValue({ user: { role: 'admin' } })
    mockUseRentals.mockReturnValue({
      data: { data: [mockRental], total: 25, page: 1, limit: 20 },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /próxima/i })).toBeInTheDocument())
  })

  it('mostra range de paginação', async () => {
    mockUseAuthStore.mockReturnValue({ user: { role: 'admin' } })
    mockUseRentals.mockReturnValue({
      data: { data: [mockRental], total: 25, page: 1, limit: 20 },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    renderPage()
    await waitFor(() => expect(screen.getByText(/Mostrando 1–20 de 25/)).toBeInTheDocument())
  })
})
