import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CreateReturnPage } from '@/features/returns/pages/CreateReturnPage'
import { useRental } from '@/features/rentals/hooks/useRentals'
import { useCreateReturn } from '@/features/returns/hooks/useReturns'
import { returnSchema } from '@/schemas/return.schema'

vi.mock('@/features/rentals/hooks/useRentals', () => ({
  useRental: vi.fn(),
}))

vi.mock('@/features/returns/hooks/useReturns', () => ({
  useCreateReturn: vi.fn(),
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
const mockUseCreateReturn = useCreateReturn as unknown as ReturnType<typeof vi.fn>

const mockRentalItem = {
  id: 'ri-1',
  rentalId: 'rental-1',
  itemId: 'item-1',
  quantity: 3,
  unitPrice: '15.00',
  returnedQty: 0,
  item: { id: 'item-1', name: 'Andaime 1m', code: 'AND-001', dailyRate: '15.00' },
}

const mockRental = {
  id: 'rental-1',
  contractNumber: '2026-0001',
  status: 'active',
  computedStatus: 'active',
  daysOverdue: 0,
  customerId: 'cust-1',
  customer: { id: 'cust-1', name: 'Acme', document: '12345678000195' },
  rentalItems: [mockRentalItem],
  startedAt: '2026-05-01',
  expectedReturn: '2026-05-08',
  deposit: '0',
  discount: '0',
  lateFee: '0',
  extraCosts: '0',
  paidAmount: '0',
  total: '105',
  subtotal: '105',
  userId: 'user-1',
  pricingType: 'daily',
  createdAt: '2026-05-01',
  updatedAt: '2026-05-01',
}

function renderPage() {
  mockUseRental.mockReturnValue({
    data: mockRental,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })
  mockUseCreateReturn.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  })
  return render(
    <MemoryRouter>
      <CreateReturnPage />
    </MemoryRouter>,
  )
}

describe('CreateReturnPage', () => {
  it('renderiza itens pendentes disponíveis para devolução', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/Andaime 1m/i)).toBeInTheDocument()
    })
  })

  it('bloqueia submissão sem itens selecionados', async () => {
    renderPage()

    const submitBtn = screen.getByRole('button', { name: /registrar devolução/i })
    expect(submitBtn).toBeDisabled()
  })

  it('shows pending item button with correct count', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/pendente: 3/i)).toBeInTheDocument()
    })
  })

  it('shows rental contract number in header', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/2026-0001/)).toBeInTheDocument()
    })
  })

  it('shows loading state while fetching', () => {
    mockUseRental.mockReturnValue({ isLoading: true, isError: false, data: null, refetch: vi.fn() })
    mockUseCreateReturn.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
    render(<MemoryRouter><CreateReturnPage /></MemoryRouter>)
    const skeletons = document.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('shows error state on fetch failure', async () => {
    mockUseRental.mockReturnValue({ isLoading: false, isError: true, data: null, refetch: vi.fn() })
    mockUseCreateReturn.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
    render(<MemoryRouter><CreateReturnPage /></MemoryRouter>)
    await waitFor(() => {
      expect(screen.getByText(/tentar novamente/i)).toBeInTheDocument()
    })
  })
})

describe('returnSchema validation', () => {
  it('blocks damageFee > 0 for condition good', () => {
    const result = returnSchema.safeParse({
      items: [{ rentalItemId: 'ri-1', quantity: 1, condition: 'good', damageFee: 50 }],
    })
    expect(result.success).toBe(false)
  })

  it('requires damageFee for damaged condition', () => {
    const result = returnSchema.safeParse({
      items: [{ rentalItemId: 'ri-1', quantity: 1, condition: 'damaged', damageFee: 0 }],
    })
    expect(result.success).toBe(false)
  })

  it('requires damageFee for lost condition', () => {
    const result = returnSchema.safeParse({
      items: [{ rentalItemId: 'ri-1', quantity: 1, condition: 'lost' }],
    })
    expect(result.success).toBe(false)
  })

  it('passes valid return with good condition and no damageFee', () => {
    const result = returnSchema.safeParse({
      items: [{ rentalItemId: 'ri-1', quantity: 1, condition: 'good', damageFee: 0 }],
    })
    expect(result.success).toBe(true)
  })

  it('passes valid return with damaged condition and damageFee', () => {
    const result = returnSchema.safeParse({
      items: [{ rentalItemId: 'ri-1', quantity: 1, condition: 'damaged', damageFee: 50 }],
    })
    expect(result.success).toBe(true)
  })

  it('fails when no items provided', () => {
    const result = returnSchema.safeParse({ items: [] })
    expect(result.success).toBe(false)
  })

  it('passes valid return with lost condition and damageFee', () => {
    const result = returnSchema.safeParse({
      items: [{ rentalItemId: 'ri-1', quantity: 1, condition: 'lost', damageFee: 100 }],
    })
    expect(result.success).toBe(true)
  })
})
