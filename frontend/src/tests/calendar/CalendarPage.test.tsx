import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { CalendarPage } from '@/features/calendar/pages/CalendarPage'
import { useCalendarRentals } from '@/features/calendar/hooks/useCalendarRentals'
import { useAuthStore } from '@/stores/auth.store'

// Mock FullCalendar — renderiza eventos como botões clicáveis para testes
vi.mock('@fullcalendar/react', () => ({
  default: ({ events, eventClick }: any) => (
    <div data-testid="fullcalendar">
      {(events ?? []).map((event: any) => (
        <button
          key={event.id}
          data-event-id={event.id}
          data-color={event.backgroundColor}
          onClick={() => eventClick?.({ event: { id: event.id } })}
        >
          {event.title}
        </button>
      ))}
    </div>
  ),
}))
vi.mock('@fullcalendar/daygrid', () => ({ default: {} }))
vi.mock('@fullcalendar/list', () => ({ default: {} }))
vi.mock('@fullcalendar/core/locales/pt-br', () => ({ default: {} }))

vi.mock('@/features/calendar/hooks/useCalendarRentals', () => ({
  useCalendarRentals: vi.fn(),
}))
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: vi.fn(),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

const mockUseCalendarRentals = useCalendarRentals as unknown as ReturnType<typeof vi.fn>
const mockUseAuthStore = useAuthStore as unknown as ReturnType<typeof vi.fn>

const mockRental = {
  id: 'rental-1',
  contractNumber: '2026-0001',
  expectedReturn: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  status: 'active' as const,
  computedStatus: 'active' as const,
  customer: { id: 'cust-1', name: 'João Silva', document: '12345678901' },
  daysOverdue: 0,
}

const mockRentalOverdue = {
  ...mockRental,
  id: 'rental-2',
  contractNumber: '2026-0002',
  expectedReturn: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  computedStatus: 'overdue' as const,
  daysOverdue: 2,
}

function setupMocks(role = 'admin') {
  mockUseAuthStore.mockReturnValue({ user: { role } })
  mockUseCalendarRentals.mockReturnValue({
    data: { data: [mockRental], total: 1, page: 1, limit: 500 },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })
}

function renderPage() {
  return render(<MemoryRouter><CalendarPage /></MemoryRouter>)
}

describe('CalendarPage', () => {
  beforeEach(() => {
    mockNavigate.mockReset()
  })

  it('renderiza loading state', async () => {
    mockUseAuthStore.mockReturnValue({ user: { role: 'admin' } })
    mockUseCalendarRentals.mockReturnValue({ isLoading: true, isError: false, data: undefined })
    renderPage()
    await waitFor(() => expect(screen.getAllByRole('status').length).toBeGreaterThan(0))
  })

  it('renderiza error state com botão retry', async () => {
    mockUseAuthStore.mockReturnValue({ user: { role: 'admin' } })
    mockUseCalendarRentals.mockReturnValue({ isLoading: false, isError: true, data: undefined, refetch: vi.fn() })
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument())
  })

  it('renderiza empty state quando sem locações ativas', async () => {
    mockUseAuthStore.mockReturnValue({ user: { role: 'admin' } })
    mockUseCalendarRentals.mockReturnValue({
      data: { data: [], total: 0, page: 1, limit: 500 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    renderPage()
    await waitFor(() => expect(screen.getByText(/nenhuma locação/i)).toBeInTheDocument())
  })

  it('renderiza título do evento com contractNumber e customer.name', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Contrato 2026-0001 · João Silva')).toBeInTheDocument()
    })
  })

  it('legenda visível com os 4 status', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Atrasado')).toBeInTheDocument()
      expect(screen.getByText('Vence hoje')).toBeInTheDocument()
      expect(screen.getByText('Próximos 1–3 dias')).toBeInTheDocument()
      expect(screen.getByText('Futuro')).toBeInTheDocument()
    })
  })

  it('ao clicar em evento, navega para /rentals/:rentalId', async () => {
    const user = userEvent.setup()
    setupMocks()
    renderPage()
    await waitFor(() => screen.getByText('Contrato 2026-0001 · João Silva'))
    await user.click(screen.getByText('Contrato 2026-0001 · João Silva'))
    expect(mockNavigate).toHaveBeenCalledWith('/rentals/rental-1')
  })

  it('evento futuro (5 dias) recebe cor verde', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => screen.getByText('Contrato 2026-0001 · João Silva'))
    const eventEl = screen.getByText('Contrato 2026-0001 · João Silva')
    expect(eventEl).toHaveAttribute('data-color', '#22c55e')
  })

  it('evento atrasado recebe cor vermelha', async () => {
    mockUseAuthStore.mockReturnValue({ user: { role: 'admin' } })
    mockUseCalendarRentals.mockReturnValue({
      data: { data: [mockRentalOverdue], total: 1, page: 1, limit: 500 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    renderPage()
    await waitFor(() => screen.getByText('Contrato 2026-0002 · João Silva'))
    const eventEl = screen.getByText('Contrato 2026-0002 · João Silva')
    expect(eventEl).toHaveAttribute('data-color', '#ef4444')
  })

  it('admin acessa sem redirect', async () => {
    setupMocks('admin')
    renderPage()
    await waitFor(() => expect(screen.getByText('Calendário')).toBeInTheDocument())
  })

  it('attendant acessa sem redirect', async () => {
    setupMocks('attendant')
    renderPage()
    await waitFor(() => expect(screen.getByText('Calendário')).toBeInTheDocument())
  })

  it('financial é redirecionado para /403', async () => {
    mockUseAuthStore.mockReturnValue({ user: { role: 'financial' } })
    mockUseCalendarRentals.mockReturnValue({ isLoading: false, isError: false, data: undefined })
    renderPage()
    await waitFor(() => expect(screen.queryByText('Calendário')).not.toBeInTheDocument())
  })
})
