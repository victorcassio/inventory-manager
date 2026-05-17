import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DashboardPage } from '@/pages/DashboardPage'
import { useDashboardSummary } from '@/features/dashboard/hooks/useDashboardSummary'

vi.mock('@/features/dashboard/hooks/useDashboardSummary', () => ({
  useDashboardSummary: vi.fn(),
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn() }
})
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  BarChart: ({ children }: any) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  AreaChart: ({ children }: any) => <div data-testid="area-chart">{children}</div>,
  Area: () => null,
  PieChart: ({ children }: any) => <div data-testid="pie-chart">{children}</div>,
  Pie: () => null,
  Cell: () => null,
}))

const mockUseDashboardSummary = useDashboardSummary as unknown as ReturnType<typeof vi.fn>

const mockSummary = {
  period: { currentMonth: '2026-05', historyMonths: 6, startDate: '2025-12-01', endDate: '2026-05-31' },
  permissions: {
    canViewFinancial: true,
    canViewOperational: true,
    canViewInventory: true,
    canViewOperationalCharts: true,
  },
  financial: {
    totalIncome: 8400,
    totalExpense: 2100,
    balance: 6300,
    recentPayments: [
      { id: 'p1', rentalId: 'r1', contractNumber: '2026-0001', customerName: 'João', amount: 500, method: 'pix', paidAt: '2026-05-15T10:00:00Z' },
    ],
  },
  rentals: {
    active: 5,
    overdue: 2,
    returned: 10,
    canceled: 1,
    byStatus: { active: 5, overdue: 2, returned: 10, canceled: 1 },
    upcomingReturns: [
      { id: 'r1', contractNumber: '2026-0001', customerName: 'João', expectedReturn: '2026-05-20' },
    ],
    overdueReturns: [
      { id: 'r2', contractNumber: '2026-0002', customerName: 'Maria', expectedReturn: '2026-05-10', daysOverdue: 7 },
    ],
  },
  inventory: {
    totalItems: 140,
    availableItems: 84,
    rentedItems: 56,
    maintenanceItems: 0,
    occupancyRate: 40,
  },
  monthlyHistory: Array.from({ length: 6 }, (_, i) => ({
    month: `2026-0${i + 1}`,
    income: 1000 * (i + 1),
    expense: 500,
    balance: 500 * (i + 1),
    cumulativeIncome: 1000 * (i + 1) * (i + 2) / 2,
  })),
}

function renderPage() {
  return render(<MemoryRouter><DashboardPage /></MemoryRouter>)
}

describe('DashboardPage', () => {
  it('renderiza loading state enquanto carrega', async () => {
    mockUseDashboardSummary.mockReturnValue({ isLoading: true, isError: false, data: undefined })
    renderPage()
    await waitFor(() => expect(screen.getByText(/carregando/i)).toBeInTheDocument())
  })

  it('renderiza error state com retry', async () => {
    mockUseDashboardSummary.mockReturnValue({ isLoading: false, isError: true, data: undefined, refetch: vi.fn() })
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument())
  })

  it('admin vê todas as seções (financial, rentals, inventory)', async () => {
    mockUseDashboardSummary.mockReturnValue({ isLoading: false, isError: false, data: mockSummary })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('💰 Financeiro — Mês atual')).toBeInTheDocument()
      expect(screen.getByText('📋 Locações')).toBeInTheDocument()
      expect(screen.getByText('📦 Estoque')).toBeInTheDocument()
    })
  })

  it('attendant não vê FinancialSection', async () => {
    const attendantSummary = {
      ...mockSummary,
      permissions: { canViewFinancial: false, canViewOperational: true, canViewInventory: true, canViewOperationalCharts: true },
      financial: null,
    }
    mockUseDashboardSummary.mockReturnValue({ isLoading: false, isError: false, data: attendantSummary })
    renderPage()
    await waitFor(() => {
      expect(screen.queryByText('💰 Financeiro — Mês atual')).not.toBeInTheDocument()
      expect(screen.getByText('📋 Locações')).toBeInTheDocument()
    })
  })

  it('financial não vê gráficos operacionais quando canViewOperationalCharts = false', async () => {
    const financialSummary = {
      ...mockSummary,
      permissions: { canViewFinancial: true, canViewOperational: true, canViewInventory: true, canViewOperationalCharts: false },
    }
    mockUseDashboardSummary.mockReturnValue({ isLoading: false, isError: false, data: financialSummary })
    renderPage()
    await waitFor(() => {
      expect(screen.queryByText('Locações por Status')).not.toBeInTheDocument()
      expect(screen.queryByText('Ocupação do Estoque')).not.toBeInTheDocument()
    })
  })

  it('FinancialSection exibe receita, despesas e saldo', async () => {
    mockUseDashboardSummary.mockReturnValue({ isLoading: false, isError: false, data: mockSummary })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Receita')).toBeInTheDocument()
      expect(screen.getByText('Despesas')).toBeInTheDocument()
      expect(screen.getByText('Saldo')).toBeInTheDocument()
    })
  })

  it('RentalsSection exibe active, overdue, returned, canceled', async () => {
    mockUseDashboardSummary.mockReturnValue({ isLoading: false, isError: false, data: mockSummary })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Ativas')).toBeInTheDocument()
      expect(screen.getByText('Vencidas')).toBeInTheDocument()
      expect(screen.getByText('Finalizadas')).toBeInTheDocument()
      expect(screen.getByText('Canceladas')).toBeInTheDocument()
    })
  })

  it('InventorySection exibe occupancyRate como badge', async () => {
    mockUseDashboardSummary.mockReturnValue({ isLoading: false, isError: false, data: mockSummary })
    renderPage()
    await waitFor(() => expect(screen.getByText('40.0% ocupado')).toBeInTheDocument())
  })

  it('RecentPaymentsList renderiza pagamentos com link', async () => {
    mockUseDashboardSummary.mockReturnValue({ isLoading: false, isError: false, data: mockSummary })
    renderPage()
    await waitFor(() => expect(screen.getAllByText('#2026-0001').length).toBeGreaterThan(0))
  })

  it('OverdueReturnsList renderiza devoluções atrasadas com badge de dias', async () => {
    mockUseDashboardSummary.mockReturnValue({ isLoading: false, isError: false, data: mockSummary })
    renderPage()
    await waitFor(() => expect(screen.getByText('7d')).toBeInTheDocument())
  })

  it('UpcomingReturnsList renderiza próximas devoluções', async () => {
    mockUseDashboardSummary.mockReturnValue({ isLoading: false, isError: false, data: mockSummary })
    renderPage()
    await waitFor(() => expect(screen.getByText('Próximas Devoluções')).toBeInTheDocument())
  })
})
