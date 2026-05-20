import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { CalendarPage } from '@/features/calendar/pages/CalendarPage'
import { useCalendarRentals } from '@/features/calendar/hooks/useCalendarRentals'
import { useAuthStore } from '@/stores/auth.store'

// Mock FullCalendar — expõe initialView e eventos como botões clicáveis
vi.mock('@fullcalendar/react', () => ({
  default: ({ events, eventClick, initialView }: any) => (
    <div data-testid="fullcalendar" data-initial-view={initialView}>
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

// Helpers para simular viewport
function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, writable: true, configurable: true })
}

describe('CalendarPage', () => {
  beforeEach(() => {
    mockNavigate.mockReset()
    setViewport(1024) // default desktop
  })

  // --- Estados de carregamento ---

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

  // --- Desktop (window.innerWidth = 1024) ---

  it('desktop: initialView é dayGridMonth', async () => {
    setupMocks()
    renderPage()
    await waitFor(() =>
      expect(screen.getByTestId('fullcalendar')).toHaveAttribute('data-initial-view', 'dayGridMonth')
    )
  })

  it('desktop: título do evento usa formato longo "Contrato X · Nome"', async () => {
    setupMocks()
    renderPage()
    await waitFor(() =>
      expect(screen.getByText('Contrato 2026-0001 · João Silva')).toBeInTheDocument()
    )
  })

  it('desktop: toolbar nativa do FullCalendar é usada (sem mobile-toolbar)', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => expect(screen.queryByTestId('mobile-toolbar')).not.toBeInTheDocument())
  })

  // --- Mobile (window.innerWidth = 375) ---

  it('mobile: initialView é listMonth', async () => {
    setViewport(375)
    setupMocks()
    renderPage()
    await waitFor(() =>
      expect(screen.getByTestId('fullcalendar')).toHaveAttribute('data-initial-view', 'listMonth')
    )
  })

  it('mobile: título do evento usa formato curto "#número · nome"', async () => {
    setViewport(375)
    setupMocks()
    renderPage()
    await waitFor(() =>
      expect(screen.getByText('#2026-0001 · João Silva')).toBeInTheDocument()
    )
  })

  it('mobile: toolbar customizada de dois níveis é exibida', async () => {
    setViewport(375)
    setupMocks()
    renderPage()
    await waitFor(() => expect(screen.getByTestId('mobile-toolbar')).toBeInTheDocument())
  })

  it('mobile: legenda exibe os 4 status (compacta)', async () => {
    setViewport(375)
    setupMocks()
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Atrasado')).toBeInTheDocument()
      expect(screen.getByText('Vence hoje')).toBeInTheDocument()
      expect(screen.getByText('Próximos 1–3 dias')).toBeInTheDocument()
      expect(screen.getByText('Futuro')).toBeInTheDocument()
    })
  })

  it('mobile: clicar em evento navega para /rentals/:id', async () => {
    const user = userEvent.setup()
    setViewport(375)
    setupMocks()
    renderPage()
    await waitFor(() => screen.getByText('#2026-0001 · João Silva'))
    await user.click(screen.getByText('#2026-0001 · João Silva'))
    expect(mockNavigate).toHaveBeenCalledWith('/rentals/rental-1')
  })

  // --- Legenda (desktop) ---

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

  // --- Cores de urgência ---

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
    expect(screen.getByText('Contrato 2026-0001 · João Silva')).toHaveAttribute('data-color', '#22c55e')
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
    expect(screen.getByText('Contrato 2026-0002 · João Silva')).toHaveAttribute('data-color', '#ef4444')
  })

  // --- RBAC ---

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
