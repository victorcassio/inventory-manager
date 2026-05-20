import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  financialTransaction: { findMany: jest.fn() },
  rental: { count: jest.fn(), findMany: jest.fn() },
  item: { findMany: jest.fn(), aggregate: jest.fn() },
  payment: { findMany: jest.fn() },
};

function setupDefaultMocks() {
  mockPrisma.financialTransaction.findMany.mockResolvedValue([]);
  mockPrisma.rental.count.mockResolvedValue(0);
  mockPrisma.rental.findMany.mockResolvedValue([]);
  mockPrisma.item.aggregate.mockResolvedValue({ _sum: { totalQty: null, availableQty: null, rentedQty: null, maintenanceQty: null } });
  mockPrisma.payment.findMany.mockResolvedValue([]);
}

describe('DashboardService', () => {
  let service: DashboardService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<DashboardService>(DashboardService);
  });

  // ─── Permissions ──────────────────────────────────────────────────────────

  it('aplica permissions corretamente para admin', () => {
    const p = service.buildPermissions(UserRole.admin);
    expect(p.canViewFinancial).toBe(true);
    expect(p.canViewOperational).toBe(true);
    expect(p.canViewInventory).toBe(true);
    expect(p.canViewOperationalCharts).toBe(true);
  });

  it('aplica permissions corretamente para financial', () => {
    const p = service.buildPermissions(UserRole.financial);
    expect(p.canViewFinancial).toBe(true);
    expect(p.canViewOperational).toBe(true);
    expect(p.canViewInventory).toBe(true);
    expect(p.canViewOperationalCharts).toBe(false);
  });

  it('aplica permissions corretamente para attendant', () => {
    const p = service.buildPermissions(UserRole.attendant);
    expect(p.canViewFinancial).toBe(false);
    expect(p.canViewOperational).toBe(true);
    expect(p.canViewInventory).toBe(true);
    expect(p.canViewOperationalCharts).toBe(true);
  });

  // ─── Financial ────────────────────────────────────────────────────────────

  it('retorna KPIs financeiros para admin', async () => {
    // For admin: getFinancialData calls financialTransaction.findMany (1st call, current month KPIs)
    // getMonthlyHistory calls financialTransaction.findMany (2nd call, 6-month history)
    // Use mockImplementation so both calls return the same income/expense data
    mockPrisma.financialTransaction.findMany.mockResolvedValue([
      { type: 'income', amount: '8400.00', date: new Date() },
      { type: 'expense', amount: '2100.00', date: new Date() },
    ]);
    mockPrisma.payment.findMany.mockResolvedValue([]);
    mockPrisma.rental.count.mockResolvedValue(0);
    mockPrisma.rental.findMany.mockResolvedValue([]);
    mockPrisma.item.aggregate.mockResolvedValue({ _sum: { totalQty: null, availableQty: null, rentedQty: null, maintenanceQty: null } });

    const result = await service.getSummary(UserRole.admin);
    expect(result.financial?.totalIncome).toBe(8400);
    expect(result.financial?.totalExpense).toBe(2100);
    expect(result.financial?.balance).toBe(6300);
  });

  it('retorna KPIs financeiros para financial', async () => {
    mockPrisma.financialTransaction.findMany.mockResolvedValue([
      { type: 'income', amount: '5000.00', date: new Date() },
    ]);
    mockPrisma.payment.findMany.mockResolvedValue([]);
    mockPrisma.rental.count.mockResolvedValue(0);
    mockPrisma.rental.findMany.mockResolvedValue([]);
    mockPrisma.item.aggregate.mockResolvedValue({ _sum: { totalQty: null, availableQty: null, rentedQty: null, maintenanceQty: null } });

    const result = await service.getSummary(UserRole.financial);
    expect(result.financial?.totalIncome).toBe(5000);
    expect(result.permissions.canViewFinancial).toBe(true);
  });

  it('não retorna financial para attendant (financial = null)', async () => {
    setupDefaultMocks();
    const result = await service.getSummary(UserRole.attendant);
    expect(result.financial).toBeNull();
    expect(result.permissions.canViewFinancial).toBe(false);
  });

  it('calcula totalIncome ignorando isVoided', async () => {
    mockPrisma.financialTransaction.findMany.mockResolvedValue([
      { type: 'income', amount: '1000.00', date: new Date() },
    ]);
    mockPrisma.payment.findMany.mockResolvedValue([]);
    mockPrisma.rental.count.mockResolvedValue(0);
    mockPrisma.rental.findMany.mockResolvedValue([]);
    mockPrisma.item.aggregate.mockResolvedValue({ _sum: { totalQty: null, availableQty: null, rentedQty: null, maintenanceQty: null } });

    await service.getSummary(UserRole.admin);
    const [whereArg] = mockPrisma.financialTransaction.findMany.mock.calls[0];
    expect(whereArg.where.isVoided).toBe(false);
  });

  it('calcula balance corretamente', async () => {
    mockPrisma.financialTransaction.findMany.mockResolvedValue([
      { type: 'income', amount: '3000.00', date: new Date() },
      { type: 'expense', amount: '1000.00', date: new Date() },
    ]);
    mockPrisma.payment.findMany.mockResolvedValue([]);
    mockPrisma.rental.count.mockResolvedValue(0);
    mockPrisma.rental.findMany.mockResolvedValue([]);
    mockPrisma.item.aggregate.mockResolvedValue({ _sum: { totalQty: null, availableQty: null, rentedQty: null, maintenanceQty: null } });

    const result = await service.getSummary(UserRole.admin);
    expect(result.financial?.balance).toBe(2000);
  });

  // ─── Rentals ──────────────────────────────────────────────────────────────

  it('calcula rentals.active sem incluir vencidas', async () => {
    setupDefaultMocks();
    mockPrisma.rental.count
      .mockResolvedValueOnce(5)  // active
      .mockResolvedValueOnce(2)  // overdue
      .mockResolvedValueOnce(10) // returned
      .mockResolvedValueOnce(1); // canceled

    const result = await service.getSummary(UserRole.attendant);
    expect(result.rentals.active).toBe(5);

    const activeCalls = mockPrisma.rental.count.mock.calls;
    expect(activeCalls[0][0].where.status).toBe('active');
    expect(activeCalls[0][0].where.expectedReturn.gte).toBeDefined();
  });

  it('calcula rentals.overdue com expectedReturn vencido', async () => {
    setupDefaultMocks();
    mockPrisma.rental.count
      .mockResolvedValueOnce(3)  // active
      .mockResolvedValueOnce(4)  // overdue
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    const result = await service.getSummary(UserRole.attendant);
    expect(result.rentals.overdue).toBe(4);

    const overdueCalls = mockPrisma.rental.count.mock.calls;
    expect(overdueCalls[1][0].where.status).toBe('active');
    expect(overdueCalls[1][0].where.expectedReturn.lt).toBeDefined();
  });

  it('calcula rentals.returned e rentals.canceled', async () => {
    setupDefaultMocks();
    mockPrisma.rental.count
      .mockResolvedValueOnce(0) // active
      .mockResolvedValueOnce(0) // overdue
      .mockResolvedValueOnce(8) // returned
      .mockResolvedValueOnce(3); // canceled

    const result = await service.getSummary(UserRole.attendant);
    expect(result.rentals.returned).toBe(8);
    expect(result.rentals.canceled).toBe(3);
  });

  it('retorna upcomingReturns dos próximos 7 dias', async () => {
    setupDefaultMocks();
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 3);
    mockPrisma.rental.findMany
      .mockResolvedValueOnce([{
        id: 'r1',
        contractNumber: '2026-0001',
        customer: { name: 'João' },
        expectedReturn: futureDate,
      }])
      .mockResolvedValueOnce([]); // overdueReturns

    const result = await service.getSummary(UserRole.attendant);
    expect(result.rentals.upcomingReturns).toHaveLength(1);
    expect(result.rentals.upcomingReturns[0].contractNumber).toBe('2026-0001');
    expect(result.rentals.upcomingReturns[0].customerName).toBe('João');
  });

  it('retorna overdueReturns com daysOverdue', async () => {
    setupDefaultMocks();
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 5);
    mockPrisma.rental.findMany
      .mockResolvedValueOnce([]) // upcomingReturns
      .mockResolvedValueOnce([{
        id: 'r2',
        contractNumber: '2026-0002',
        customer: { name: 'Maria' },
        expectedReturn: pastDate,
      }]);

    const result = await service.getSummary(UserRole.attendant);
    expect(result.rentals.overdueReturns).toHaveLength(1);
    expect(result.rentals.overdueReturns[0].daysOverdue).toBe(5);
  });

  // ─── Inventory ────────────────────────────────────────────────────────────

  it('calcula inventory.occupancyRate', async () => {
    setupDefaultMocks();
    mockPrisma.item.aggregate.mockResolvedValue({ _sum: { totalQty: 100, availableQty: 60, rentedQty: 40, maintenanceQty: 0 } });

    const result = await service.getSummary(UserRole.attendant);
    expect(result.inventory.occupancyRate).toBe(40);
    expect(result.inventory.totalItems).toBe(100);
    expect(result.inventory.availableItems).toBe(60);
    expect(result.inventory.rentedItems).toBe(40);
  });

  it('retorna occupancyRate = 0 quando totalItems = 0', async () => {
    setupDefaultMocks();
    mockPrisma.item.aggregate.mockResolvedValue({ _sum: { totalQty: null, availableQty: null, rentedQty: null, maintenanceQty: null } });

    const result = await service.getSummary(UserRole.attendant);
    expect(result.inventory.occupancyRate).toBe(0);
    expect(result.inventory.totalItems).toBe(0);
  });

  // ─── Monthly History ──────────────────────────────────────────────────────

  it('retorna monthlyHistory com exatamente 6 meses', async () => {
    setupDefaultMocks();
    const result = await service.getSummary(UserRole.attendant);
    expect(result.monthlyHistory).toHaveLength(6);
  });

  it('preenche meses sem dados com zero', async () => {
    setupDefaultMocks();
    const result = await service.getSummary(UserRole.attendant);
    result.monthlyHistory.forEach(m => {
      expect(m.income).toBeGreaterThanOrEqual(0);
      expect(m.expense).toBeGreaterThanOrEqual(0);
    });
  });

  it('calcula cumulativeIncome corretamente', async () => {
    setupDefaultMocks();
    const now = new Date();
    const m1 = new Date(now.getFullYear(), now.getMonth() - 1, 15);
    const m2 = new Date(now.getFullYear(), now.getMonth(), 15);
    mockPrisma.financialTransaction.findMany.mockResolvedValue([
      { type: 'income', amount: '1000.00', date: m1 },
      { type: 'income', amount: '2000.00', date: m2 },
    ]);

    const result = await service.getSummary(UserRole.attendant);
    const lastTwo = result.monthlyHistory.slice(-2);
    expect(lastTwo[0].income).toBe(1000);
    expect(lastTwo[1].income).toBe(2000);
    expect(lastTwo[1].cumulativeIncome).toBe(lastTwo[0].cumulativeIncome + 2000);
  });

  // ─── Recent Payments ──────────────────────────────────────────────────────

  it('retorna recentPayments limitado a 5', async () => {
    const now = new Date();
    mockPrisma.financialTransaction.findMany.mockResolvedValue([]);
    mockPrisma.payment.findMany.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        id: `p${i}`,
        rentalId: `r${i}`,
        amount: '100.00',
        method: 'pix',
        paidAt: now,
        rental: { id: `r${i}`, contractNumber: `2026-000${i}`, customer: { name: 'X' } },
      })),
    );
    mockPrisma.rental.count.mockResolvedValue(0);
    mockPrisma.rental.findMany.mockResolvedValue([]);
    mockPrisma.item.aggregate.mockResolvedValue({ _sum: { totalQty: null, availableQty: null, rentedQty: null, maintenanceQty: null } });

    const result = await service.getSummary(UserRole.admin);
    expect(result.financial?.recentPayments).toHaveLength(5);

    const paymentCall = mockPrisma.payment.findMany.mock.calls[0][0];
    expect(paymentCall.take).toBe(5);
    expect(paymentCall.orderBy.paidAt).toBe('desc');
  });
});
