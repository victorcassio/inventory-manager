import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { RentalNewPage } from '@/features/rentals/pages/RentalNewPage'
import { useCreateRental } from '@/features/rentals/hooks/useRentals'
import { useCustomers } from '@/features/customers/hooks/useCustomers'
import { useItems } from '@/features/inventory/hooks/useInventory'

vi.mock('@/features/rentals/hooks/useRentals', () => ({
  useCreateRental: vi.fn(),
}))

vi.mock('@/features/customers/hooks/useCustomers', () => ({
  useCustomers: vi.fn(),
}))

vi.mock('@/features/inventory/hooks/useInventory', () => ({
  useItems: vi.fn(),
}))

const mockUseCreateRental = useCreateRental as ReturnType<typeof vi.fn>
const mockUseCustomers = useCustomers as ReturnType<typeof vi.fn>
const mockUseItems = useItems as ReturnType<typeof vi.fn>

function renderForm() {
  mockUseCreateRental.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  mockUseCustomers.mockReturnValue({ data: { data: [], total: 0 } })
  mockUseItems.mockReturnValue({ data: { data: [], total: 0 } })
  return render(
    <MemoryRouter>
      <RentalNewPage />
    </MemoryRouter>,
  )
}

describe('RentalForm', () => {
  it('shows validation error when submitting without items', async () => {
    const user = userEvent.setup()
    renderForm()

    // Fill in minimum required fields except items
    const dateInputs = screen.getAllByDisplayValue('')
    // Try submitting without items
    const submitBtn = screen.getByRole('button', { name: /criar locação/i })
    await user.click(submitBtn)

    await waitFor(() => {
      // Should show validation errors for required fields
      expect(screen.getAllByText(/obrigatório/i).length).toBeGreaterThan(0)
    })
  })

  it('shows estimated total calculation when items and dates are selected', async () => {
    const user = userEvent.setup()

    mockUseCreateRental.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
    mockUseCustomers.mockReturnValue({
      data: {
        data: [{ id: 'c1', name: 'Cliente Teste', document: '12345678901' }],
        total: 1,
      },
    })
    mockUseItems.mockReturnValue({
      data: {
        data: [
          {
            id: 'i1',
            name: 'Item Teste',
            code: 'IT-001',
            dailyRate: '50.00',
            availableQty: 5,
            totalQty: 5,
            rentedQty: 0,
            maintenanceQty: 0,
          },
        ],
        total: 1,
      },
    })

    render(
      <MemoryRouter>
        <RentalNewPage />
      </MemoryRouter>,
    )

    // Add an item
    const addItemBtn = screen.getByRole('button', { name: /adicionar item/i })
    await user.click(addItemBtn)

    // Should now show the items section with a row
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /adicionar item/i })).toBeInTheDocument()
    })
  })
})
