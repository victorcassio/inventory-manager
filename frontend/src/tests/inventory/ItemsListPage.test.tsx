// src/tests/inventory/ItemsListPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ItemsListPage } from '@/features/inventory/pages/ItemsListPage'
import { useItems, useCategories } from '@/features/inventory/hooks/useInventory'
import { useAuthStore } from '@/stores/auth.store'

vi.mock('@/features/inventory/hooks/useInventory', () => ({
  useItems: vi.fn(),
  useCategories: vi.fn(),
}))
vi.mock('@/stores/auth.store', () => ({ useAuthStore: vi.fn() }))
vi.mock('@/hooks/usePagination', () => ({
  usePagination: () => ({ page: 1, limit: 20, setPage: vi.fn() }),
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn() }
})

const mockUseItems = useItems as unknown as ReturnType<typeof vi.fn>
const mockUseCategories = useCategories as unknown as ReturnType<typeof vi.fn>
const mockUseAuthStore = useAuthStore as unknown as ReturnType<typeof vi.fn>

const mockItem = {
  id: 'item-1',
  code: 'AND-1M',
  name: 'Andaime Tubular 1m',
  dailyRate: '4.50',
  totalQty: 10,
  availableQty: 7,
  condition: 'good',
  category: { id: 'cat-1', name: 'Andaimes' },
}

function setupMocks() {
  mockUseAuthStore.mockReturnValue({ user: { role: 'admin' } })
  mockUseCategories.mockReturnValue({ data: [] })
  mockUseItems.mockReturnValue({
    data: { data: [mockItem], total: 1, page: 1, limit: 20 },
    isLoading: false, isError: false, refetch: vi.fn(),
  })
}

function renderPage() {
  return render(<MemoryRouter><ItemsListPage /></MemoryRouter>)
}

describe('ItemsListPage', () => {
  it('exibe nome do item', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => expect(screen.getAllByText('Andaime Tubular 1m').length).toBeGreaterThan(0))
  })

  it('exibe código do item', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => expect(screen.getAllByText(/AND-1M/).length).toBeGreaterThan(0))
  })

  it('mostra range de paginação quando total > limit', async () => {
    mockUseAuthStore.mockReturnValue({ user: { role: 'admin' } })
    mockUseCategories.mockReturnValue({ data: [] })
    mockUseItems.mockReturnValue({
      data: { data: [mockItem], total: 25, page: 1, limit: 20 },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    renderPage()
    await waitFor(() => expect(screen.getByText(/Mostrando 1–20 de 25/)).toBeInTheDocument())
  })
})
