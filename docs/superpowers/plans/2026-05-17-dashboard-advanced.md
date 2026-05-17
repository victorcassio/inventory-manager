# Dashboard Avançado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a full-featured dashboard — backend `GET /dashboard/summary` (NestJS + Prisma) and frontend KPI cards, 4 Recharts charts, and 3 event lists, replacing the static placeholder.

**Architecture:** Single backend endpoint aggregates all dashboard data via `Promise.all()`. Frontend fetches it once with TanStack Query (staleTime 5min) and distributes to 10 focused components. RBAC controlled by `permissions` flags in the API response, not hardcoded role checks in the frontend.

**Tech Stack:** NestJS, Prisma 7, Jest (backend) · React 18, TanStack Query v5, Recharts, Vitest + Testing Library (frontend).

---

## File Map

| File | Action |
|---|---|
| `backend/src/modules/dashboard/dashboard.module.ts` | Create |
| `backend/src/modules/dashboard/dashboard.controller.ts` | Create |
| `backend/src/modules/dashboard/dashboard.service.ts` | Create |
| `backend/src/modules/dashboard/dashboard.service.spec.ts` | Create |
| `backend/src/app.module.ts` | Modify — register DashboardModule |
| `frontend/src/types/index.ts` | Modify — add Dashboard types |
| `frontend/src/lib/api/dashboard.api.ts` | Create |
| `frontend/src/features/dashboard/hooks/useDashboardSummary.ts` | Create |
| `frontend/src/features/dashboard/components/FinancialSection.tsx` | Create |
| `frontend/src/features/dashboard/components/RentalsSection.tsx` | Create |
| `frontend/src/features/dashboard/components/InventorySection.tsx` | Create |
| `frontend/src/features/dashboard/components/RevenueBarChart.tsx` | Create |
| `frontend/src/features/dashboard/components/CumulativeLineChart.tsx` | Create |
| `frontend/src/features/dashboard/components/RentalStatusPieChart.tsx` | Create |
| `frontend/src/features/dashboard/components/InventoryOccupancyBar.tsx` | Create |
| `frontend/src/features/dashboard/components/RecentPaymentsList.tsx` | Create |
| `frontend/src/features/dashboard/components/UpcomingReturnsList.tsx` | Create |
| `frontend/src/features/dashboard/components/OverdueReturnsList.tsx` | Create |
| `frontend/src/pages/DashboardPage.tsx` | Modify — replace placeholder |
| `frontend/src/tests/dashboard/DashboardPage.test.tsx` | Create |

---

## Task 1: Backend — DashboardModule Skeleton

**Files:**
- Create: `backend/src/modules/dashboard/dashboard.module.ts`
- Create: `backend/src/modules/dashboard/dashboard.controller.ts`
- Create: `backend/src/modules/dashboard/dashboard.service.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Create `dashboard.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(role: UserRole) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const permissions = this.buildPermissions(role);
    const period = this.buildPeriod(now);

    const [financialData, rentalsData, inventoryData, monthlyHistory] =
      await Promise.all([
        permissions.canViewFinancial
          ? this.getFinancialData(now, today)
          : Promise.resolve(null),
        this.getRentalsData(today),
        this.getInventoryData(),
        this.getMonthlyHistory(now),
      ]);

    return { period, permissions, financial: financialData, rentals: rentalsData, inventory: inventoryData, monthlyHistory };
  }

  buildPermissions(role: UserRole) {
    return {
      canViewFinancial: role === UserRole.admin || role === UserRole.financial,
      canViewOperational: true,
      canViewInventory: true,
      canViewOperationalCharts: role === UserRole.admin || role === UserRole.attendant,
    };
  }

  buildPeriod(now: Date) {
    const year = now.getFullYear();
    const month = now.getMonth();
    const currentMonth = `${year}-${String(month + 1).padStart(2, '0')}`;
    const sixMonthsAgo = new Date(year, month - 5, 1);
    const endOfMonth = new Date(year, month + 1, 0);
    return {
      currentMonth,
      historyMonths: 6,
      startDate: sixMonthsAgo.toISOString().split('T')[0],
      endDate: endOfMonth.toISOString().split('T')[0],
    };
  }

  async getFinancialData(now: Date, today: Date) {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const [transactions, recentPayments] = await Promise.all([
      this.prisma.financialTransaction.findMany({
        where: { isVoided: false, date: { gte: startOfMonth, lte: endOfMonth } },
        select: { type: true, amount: true },
      }),
      this.prisma.payment.findMany({
        orderBy: { paidAt: 'desc' },
        take: 5,
        include: {
          rental: {
            select: {
              id: true,
              contractNumber: true,
              customer: { select: { name: true } },
            },
          },
        },
      }),
    ]);

    const totalIncome = transactions
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + Number(t.amount), 0);
    const totalExpense = transactions
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + Number(t.amount), 0);

    return {
      totalIncome,
      totalExpense,
      balance: totalIncome - totalExpense,
      recentPayments: recentPayments.map(p => ({
        id: p.id,
        rentalId: p.rentalId,
        contractNumber: p.rental?.contractNumber ?? '',
        customerName: p.rental?.customer?.name ?? '',
        amount: Number(p.amount),
        method: p.method as string,
        paidAt: p.paidAt.toISOString(),
      })),
    };
  }

  async getRentalsData(today: Date) {
    const sevenDaysFromNow = new Date(today);
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    const [active, overdue, returned, canceled, upcomingRentals, overdueRentals] =
      await Promise.all([
        this.prisma.rental.count({
          where: { status: 'active', expectedReturn: { gte: today } },
        }),
        this.prisma.rental.count({
          where: { status: 'active', expectedReturn: { lt: today } },
        }),
        this.prisma.rental.count({ where: { status: 'returned' } }),
        this.prisma.rental.count({ where: { status: 'canceled' } }),
        this.prisma.rental.findMany({
          where: { status: 'active', expectedReturn: { gte: today, lte: sevenDaysFromNow } },
          orderBy: { expectedReturn: 'asc' },
          include: { customer: { select: { name: true } } },
        }),
        this.prisma.rental.findMany({
          where: { status: 'active', expectedReturn: { lt: today } },
          orderBy: { expectedReturn: 'asc' },
          include: { customer: { select: { name: true } } },
        }),
      ]);

    return {
      active,
      overdue,
      returned,
      canceled,
      byStatus: { active, overdue, returned, canceled },
      upcomingReturns: upcomingRentals.map(r => ({
        id: r.id,
        contractNumber: r.contractNumber,
        customerName: r.customer?.name ?? '',
        expectedReturn: r.expectedReturn.toISOString().split('T')[0],
      })),
      overdueReturns: overdueRentals.map(r => ({
        id: r.id,
        contractNumber: r.contractNumber,
        customerName: r.customer?.name ?? '',
        expectedReturn: r.expectedReturn.toISOString().split('T')[0],
        daysOverdue: Math.ceil(
          (today.getTime() - new Date(r.expectedReturn).getTime()) /
            (1000 * 60 * 60 * 24),
        ),
      })),
    };
  }

  async getInventoryData() {
    const items = await this.prisma.item.findMany({
      where: { isActive: true },
      select: { totalQty: true, availableQty: true, rentedQty: true, maintenanceQty: true },
    });
    const totalItems = items.reduce((s, i) => s + i.totalQty, 0);
    const availableItems = items.reduce((s, i) => s + i.availableQty, 0);
    const rentedItems = items.reduce((s, i) => s + i.rentedQty, 0);
    const maintenanceItems = items.reduce((s, i) => s + i.maintenanceQty, 0);
    return {
      totalItems,
      availableItems,
      rentedItems,
      maintenanceItems,
      occupancyRate: totalItems === 0 ? 0 : (rentedItems / totalItems) * 100,
    };
  }

  async getMonthlyHistory(now: Date) {
    const months: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const transactions = await this.prisma.financialTransaction.findMany({
      where: { isVoided: false, date: { gte: sixMonthsAgo, lte: endOfMonth } },
      select: { type: true, amount: true, date: true },
    });

    const byMonth: Record<string, { income: number; expense: number }> = {};
    months.forEach(m => (byMonth[m] = { income: 0, expense: 0 }));

    transactions.forEach(t => {
      const d = new Date(t.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (byMonth[key]) {
        if (t.type === 'income') byMonth[key].income += Number(t.amount);
        else byMonth[key].expense += Number(t.amount);
      }
    });

    let cumulative = 0;
    return months.map(month => {
      const { income, expense } = byMonth[month];
      cumulative += income;
      return { month, income, expense, balance: income - expense, cumulativeIncome: cumulative };
    });
  }
}
```

- [ ] **Step 2: Create `dashboard.controller.ts`**

```ts
import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  @Roles(UserRole.admin, UserRole.financial, UserRole.attendant)
  getSummary(@Request() req: any) {
    return this.dashboardService.getSummary(req.user.role);
  }
}
```

- [ ] **Step 3: Create `dashboard.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [PrismaModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
```

- [ ] **Step 4: Register in `backend/src/app.module.ts`**

Add import at the top:
```ts
import { DashboardModule } from './modules/dashboard/dashboard.module';
```

Add `DashboardModule` to the `imports` array (after `DocumentsModule`):
```ts
imports: [
  // ...existing modules...
  DocumentsModule,
  DashboardModule,
],
```

- [ ] **Step 5: Compile check**

```bash
cd backend && source ~/.nvm/nvm.sh && nvm use 20.19.4 && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/dashboard/ backend/src/app.module.ts
git commit -m "feat(dashboard): add DashboardModule with GET /dashboard/summary"
```

---

## Task 2: Backend — DashboardService Tests

**Files:**
- Create: `backend/src/modules/dashboard/dashboard.service.spec.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  financialTransaction: { findMany: jest.fn() },
  rental: { count: jest.fn(), findMany: jest.fn() },
  item: { findMany: jest.fn() },
  payment: { findMany: jest.fn() },
};

function setupDefaultMocks() {
  mockPrisma.financialTransaction.findMany.mockResolvedValue([]);
  mockPrisma.rental.count.mockResolvedValue(0);
  mockPrisma.rental.findMany.mockResolvedValue([]);
  mockPrisma.item.findMany.mockResolvedValue([]);
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
    mockPrisma.financialTransaction.findMany.mockResolvedValue([
      { type: 'income', amount: '8400.00', date: new Date() },
      { type: 'expense', amount: '2100.00', date: new Date() },
    ]);
    mockPrisma.payment.findMany.mockResolvedValue([]);
    mockPrisma.rental.count.mockResolvedValue(0);
    mockPrisma.rental.findMany.mockResolvedValue([]);
    mockPrisma.item.findMany.mockResolvedValue([]);

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
    mockPrisma.item.findMany.mockResolvedValue([]);

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
    // getFinancialData already filters isVoided:false in the where clause
    // This test verifies the where clause includes isVoided:false
    mockPrisma.financialTransaction.findMany.mockResolvedValue([
      { type: 'income', amount: '1000.00', date: new Date() },
    ]);
    mockPrisma.payment.findMany.mockResolvedValue([]);
    mockPrisma.rental.count.mockResolvedValue(0);
    mockPrisma.rental.findMany.mockResolvedValue([]);
    mockPrisma.item.findMany.mockResolvedValue([]);

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
    mockPrisma.item.findMany.mockResolvedValue([]);

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

    // Verify active query uses expectedReturn >= today
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
    mockPrisma.item.findMany.mockResolvedValue([
      { totalQty: 100, availableQty: 60, rentedQty: 40, maintenanceQty: 0 },
    ]);

    const result = await service.getSummary(UserRole.attendant);
    expect(result.inventory.occupancyRate).toBe(40);
    expect(result.inventory.totalItems).toBe(100);
    expect(result.inventory.availableItems).toBe(60);
    expect(result.inventory.rentedItems).toBe(40);
  });

  it('retorna occupancyRate = 0 quando totalItems = 0', async () => {
    setupDefaultMocks();
    mockPrisma.item.findMany.mockResolvedValue([]);

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
    // Provide 2 months of income data
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
    mockPrisma.item.findMany.mockResolvedValue([]);

    const result = await service.getSummary(UserRole.admin);
    expect(result.financial?.recentPayments).toHaveLength(5);

    const paymentCall = mockPrisma.payment.findMany.mock.calls[0][0];
    expect(paymentCall.take).toBe(5);
    expect(paymentCall.orderBy.paidAt).toBe('desc');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && source ~/.nvm/nvm.sh && nvm use 20.19.4 && npx jest --testPathPattern="dashboard.service.spec" --no-coverage 2>&1 | tail -15
```

Expected: tests fail with "service not found" or similar.

- [ ] **Step 3: Run tests after implementing service in Task 1**

```bash
cd backend && npx jest --testPathPattern="dashboard.service.spec" --no-coverage 2>&1 | tail -10
```

Expected: all 20 tests pass.

- [ ] **Step 4: Run full backend suite to confirm no regressions**

```bash
cd backend && npx jest --config jest.config.ts --no-coverage 2>&1 | tail -8
```

Expected: all tests pass (≥166 pre-existing + 20 new).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/dashboard/dashboard.service.spec.ts
git commit -m "test(dashboard): add DashboardService unit tests (20 scenarios)"
```

---

## Task 3: Frontend — Types + API Client + Hook

**Files:**
- Modify: `frontend/src/types/index.ts`
- Create: `frontend/src/lib/api/dashboard.api.ts`
- Create: `frontend/src/features/dashboard/hooks/useDashboardSummary.ts`

- [ ] **Step 1: Add types to `frontend/src/types/index.ts`**

Append at the end of the file:

```ts
export interface DashboardPeriod {
  currentMonth: string
  historyMonths: number
  startDate: string
  endDate: string
}

export interface DashboardPermissions {
  canViewFinancial: boolean
  canViewOperational: boolean
  canViewInventory: boolean
  canViewOperationalCharts: boolean
}

export interface DashboardRecentPayment {
  id: string
  rentalId: string
  contractNumber: string
  customerName: string
  amount: number
  method: string
  paidAt: string
}

export interface DashboardFinancial {
  totalIncome: number
  totalExpense: number
  balance: number
  recentPayments: DashboardRecentPayment[]
}

export interface DashboardUpcomingReturn {
  id: string
  contractNumber: string
  customerName: string
  expectedReturn: string
}

export interface DashboardOverdueReturn extends DashboardUpcomingReturn {
  daysOverdue: number
}

export interface DashboardRentals {
  active: number
  overdue: number
  returned: number
  canceled: number
  byStatus: { active: number; overdue: number; returned: number; canceled: number }
  upcomingReturns: DashboardUpcomingReturn[]
  overdueReturns: DashboardOverdueReturn[]
}

export interface DashboardInventory {
  totalItems: number
  availableItems: number
  rentedItems: number
  maintenanceItems: number
  occupancyRate: number
}

export interface DashboardMonthlyHistory {
  month: string
  income: number
  expense: number
  balance: number
  cumulativeIncome: number
}

export interface DashboardSummary {
  period: DashboardPeriod
  permissions: DashboardPermissions
  financial: DashboardFinancial | null
  rentals: DashboardRentals
  inventory: DashboardInventory
  monthlyHistory: DashboardMonthlyHistory[]
}
```

- [ ] **Step 2: Create `frontend/src/lib/api/dashboard.api.ts`**

```ts
import api from './client'
import type { DashboardSummary } from '@/types'

export const dashboardApi = {
  getSummary: () =>
    api.get<DashboardSummary>('/dashboard/summary').then(r => r.data),
}
```

- [ ] **Step 3: Create `frontend/src/features/dashboard/hooks/useDashboardSummary.ts`**

```ts
import { useQuery } from '@tanstack/react-query'
import { dashboardApi } from '@/lib/api/dashboard.api'

export function useDashboardSummary() {
  return useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: dashboardApi.getSummary,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
}
```

- [ ] **Step 4: Compile check**

```bash
cd frontend && source ~/.nvm/nvm.sh && nvm use 20.19.4 && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/index.ts \
        frontend/src/lib/api/dashboard.api.ts \
        frontend/src/features/dashboard/hooks/useDashboardSummary.ts
git commit -m "feat(dashboard): add types, API client and useDashboardSummary hook"
```

---

## Task 4: Frontend — Install Recharts + KPI Section Components

**Files:**
- Create: `frontend/src/features/dashboard/components/FinancialSection.tsx`
- Create: `frontend/src/features/dashboard/components/RentalsSection.tsx`
- Create: `frontend/src/features/dashboard/components/InventorySection.tsx`

- [ ] **Step 1: Install Recharts**

```bash
cd frontend && source ~/.nvm/nvm.sh && nvm use 20.19.4 && npm install recharts
```

Expected: recharts added to package.json, no errors.

- [ ] **Step 2: Create `FinancialSection.tsx`**

```tsx
import { TrendingUp, TrendingDown, Scale } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency } from '@/lib/formatters'
import type { DashboardFinancial } from '@/types'

interface Props {
  data: DashboardFinancial
}

export function FinancialSection({ data }: Props) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
        💰 Financeiro — Mês atual
      </h3>
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <Card className="border-green-200 bg-green-50 dark:bg-green-950 dark:border-green-800">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Receita</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-600">{formatCurrency(data.totalIncome)}</p>
          </CardContent>
        </Card>

        <Card className="border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-800">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Despesas</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-red-600">{formatCurrency(data.totalExpense)}</p>
          </CardContent>
        </Card>

        <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Saldo</CardTitle>
            <Scale className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-bold ${data.balance >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
              {formatCurrency(data.balance)}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create `RentalsSection.tsx`**

```tsx
import { ClipboardList, AlertTriangle, CheckCircle, XCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { DashboardRentals } from '@/types'

interface Props {
  data: DashboardRentals
}

export function RentalsSection({ data }: Props) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
        📋 Locações
      </h3>
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ativas</CardTitle>
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{data.active}</p>
          </CardContent>
        </Card>

        <Card className="border-orange-200 bg-orange-50 dark:bg-orange-950 dark:border-orange-800">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Vencidas</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-orange-600">{data.overdue}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Finalizadas</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{data.returned}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Canceladas</CardTitle>
            <XCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{data.canceled}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create `InventorySection.tsx`**

```tsx
import { Package, CheckCircle, Truck, Wrench } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { DashboardInventory } from '@/types'

interface Props {
  data: DashboardInventory
}

export function InventorySection({ data }: Props) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
        📦 Estoque
      </h3>
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{data.totalItems}</p>
            <Badge variant="secondary" className="mt-1 text-xs">
              {data.occupancyRate.toFixed(1)}% ocupado
            </Badge>
          </CardContent>
        </Card>

        <Card className="border-green-200 bg-green-50 dark:bg-green-950 dark:border-green-800">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Disponíveis</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-600">{data.availableItems}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Alugados</CardTitle>
            <Truck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{data.rentedItems}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Manutenção</CardTitle>
            <Wrench className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{data.maintenanceItems}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Compile check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json \
        frontend/src/features/dashboard/components/FinancialSection.tsx \
        frontend/src/features/dashboard/components/RentalsSection.tsx \
        frontend/src/features/dashboard/components/InventorySection.tsx
git commit -m "feat(dashboard): add Recharts, KPI section components"
```

---

## Task 5: Frontend — Recharts Chart Components

**Files:**
- Create: `frontend/src/features/dashboard/components/RevenueBarChart.tsx`
- Create: `frontend/src/features/dashboard/components/CumulativeLineChart.tsx`
- Create: `frontend/src/features/dashboard/components/RentalStatusPieChart.tsx`
- Create: `frontend/src/features/dashboard/components/InventoryOccupancyBar.tsx`

- [ ] **Step 1: Create shared month formatter helper**

This function is used by all charts. Add it to each chart file that needs it (inline — no shared file needed):

```ts
function formatMonth(monthStr: string): string {
  const [year, month] = monthStr.split('-')
  const date = new Date(Number(year), Number(month) - 1, 1)
  return date.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
    .replace(/\./g, '').replace(' de ', '/').replace(' ', '/')
}
```

- [ ] **Step 2: Create `RevenueBarChart.tsx`**

```tsx
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/feedback/EmptyState'
import { formatCurrency } from '@/lib/formatters'
import type { DashboardMonthlyHistory } from '@/types'

function formatMonth(monthStr: string): string {
  const [year, month] = monthStr.split('-')
  const date = new Date(Number(year), Number(month) - 1, 1)
  return date.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
    .replace(/\./g, '').replace(' de ', '/').replace(' ', '/')
}

interface Props {
  data: DashboardMonthlyHistory[]
}

export function RevenueBarChart({ data }: Props) {
  const hasData = data.some(d => d.income > 0 || d.expense > 0)

  const chartData = data.map(d => ({
    month: formatMonth(d.month),
    Receita: d.income,
    Despesas: d.expense,
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Receita × Despesas (6 meses)</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <EmptyState title="Sem dados" description="Nenhuma transação nos últimos 6 meses." />
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(value: number) => formatCurrency(value)} />
              <Legend />
              <Bar dataKey="Receita" fill="#16a34a" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Despesas" fill="#dc2626" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 3: Create `CumulativeLineChart.tsx`**

```tsx
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/feedback/EmptyState'
import { formatCurrency } from '@/lib/formatters'
import type { DashboardMonthlyHistory } from '@/types'

function formatMonth(monthStr: string): string {
  const [year, month] = monthStr.split('-')
  const date = new Date(Number(year), Number(month) - 1, 1)
  return date.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
    .replace(/\./g, '').replace(' de ', '/').replace(' ', '/')
}

interface Props {
  data: DashboardMonthlyHistory[]
}

export function CumulativeLineChart({ data }: Props) {
  const hasData = data.some(d => d.cumulativeIncome > 0)

  const chartData = data.map(d => ({
    month: formatMonth(d.month),
    'Receita Acumulada': d.cumulativeIncome,
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Receita Acumulada (6 meses)</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <EmptyState title="Sem dados" description="Nenhuma receita nos últimos 6 meses." />
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="incomeGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(value: number) => formatCurrency(value)} />
              <Area
                type="monotone"
                dataKey="Receita Acumulada"
                stroke="#6366f1"
                strokeWidth={2}
                fill="url(#incomeGradient)"
                dot={{ r: 3, fill: '#6366f1' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Create `RentalStatusPieChart.tsx`**

```tsx
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/feedback/EmptyState'
import type { DashboardRentals } from '@/types'

const COLORS = ['#6366f1', '#f97316', '#94a3b8', '#ef4444']
const LABELS = ['Ativas', 'Vencidas', 'Finalizadas', 'Canceladas']

interface Props {
  data: DashboardRentals
}

export function RentalStatusPieChart({ data }: Props) {
  const chartData = [
    { name: 'Ativas', value: data.byStatus.active },
    { name: 'Vencidas', value: data.byStatus.overdue },
    { name: 'Finalizadas', value: data.byStatus.returned },
    { name: 'Canceladas', value: data.byStatus.canceled },
  ].filter(d => d.value > 0)

  const hasData = chartData.some(d => d.value > 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Locações por Status</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <EmptyState title="Sem locações" description="Nenhuma locação registrada." />
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={90}
                dataKey="value"
                label={({ name, value }) => `${name}: ${value}`}
                labelLine={false}
              >
                {chartData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 5: Create `InventoryOccupancyBar.tsx`**

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/feedback/EmptyState'
import type { DashboardInventory } from '@/types'

interface Props {
  data: DashboardInventory
}

function ProgressBar({ label, value, max, colorClass }: { label: string; value: number; max: number; colorClass: string }) {
  const pct = max === 0 ? 0 : Math.min((value / max) * 100, 100)
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="font-semibold">{value} ({pct.toFixed(1)}%)</span>
      </div>
      <div className="h-3 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full ${colorClass}`}
          style={{ width: `${pct}%`, transition: 'width 0.3s ease' }}
        />
      </div>
    </div>
  )
}

export function InventoryOccupancyBar({ data }: Props) {
  const hasData = data.totalItems > 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Ocupação do Estoque</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <EmptyState title="Sem itens" description="Nenhum item cadastrado no estoque." />
        ) : (
          <div className="space-y-4 pt-2">
            <ProgressBar
              label="Alugados"
              value={data.rentedItems}
              max={data.totalItems}
              colorClass="bg-blue-500"
            />
            <ProgressBar
              label="Disponíveis"
              value={data.availableItems}
              max={data.totalItems}
              colorClass="bg-green-500"
            />
            <ProgressBar
              label="Manutenção"
              value={data.maintenanceItems}
              max={data.totalItems}
              colorClass="bg-orange-400"
            />
            <p className="text-xs text-muted-foreground text-right">
              Total: {data.totalItems} itens · {data.occupancyRate.toFixed(1)}% ocupado
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 6: Compile check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/dashboard/components/RevenueBarChart.tsx \
        frontend/src/features/dashboard/components/CumulativeLineChart.tsx \
        frontend/src/features/dashboard/components/RentalStatusPieChart.tsx \
        frontend/src/features/dashboard/components/InventoryOccupancyBar.tsx
git commit -m "feat(dashboard): add Recharts chart components (4 charts)"
```

---

## Task 6: Frontend — List Components

**Files:**
- Create: `frontend/src/features/dashboard/components/RecentPaymentsList.tsx`
- Create: `frontend/src/features/dashboard/components/UpcomingReturnsList.tsx`
- Create: `frontend/src/features/dashboard/components/OverdueReturnsList.tsx`

- [ ] **Step 1: Create `RecentPaymentsList.tsx`**

```tsx
import { useNavigate } from 'react-router-dom'
import { CreditCard } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/feedback/EmptyState'
import { formatCurrency, formatDate } from '@/lib/formatters'
import type { DashboardRecentPayment } from '@/types'

const METHOD_LABELS: Record<string, string> = {
  cash: 'Dinheiro',
  pix: 'PIX',
  card: 'Cartão',
  transfer: 'Transferência',
}

interface Props {
  payments: DashboardRecentPayment[]
}

export function RecentPaymentsList({ payments }: Props) {
  const navigate = useNavigate()

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base">Pagamentos Recentes</CardTitle>
        <CreditCard className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {payments.length === 0 ? (
          <EmptyState title="Sem pagamentos" description="Nenhum pagamento recente." />
        ) : (
          <ul className="space-y-3">
            {payments.map(p => (
              <li
                key={p.id}
                className="flex items-center justify-between cursor-pointer hover:bg-muted rounded-md px-2 py-1 -mx-2 transition-colors"
                onClick={() => navigate(`/rentals/${p.rentalId}`)}
              >
                <div>
                  <p className="text-sm font-medium">#{p.contractNumber}</p>
                  <p className="text-xs text-muted-foreground">{p.customerName} · {METHOD_LABELS[p.method] ?? p.method}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-green-600">{formatCurrency(p.amount)}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(p.paidAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Create `UpcomingReturnsList.tsx`**

```tsx
import { useNavigate } from 'react-router-dom'
import { Calendar } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/feedback/EmptyState'
import { formatDate } from '@/lib/formatters'
import type { DashboardUpcomingReturn } from '@/types'

interface Props {
  returns: DashboardUpcomingReturn[]
}

export function UpcomingReturnsList({ returns }: Props) {
  const navigate = useNavigate()

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base">Próximas Devoluções</CardTitle>
        <Calendar className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {returns.length === 0 ? (
          <EmptyState title="Nenhuma prevista" description="Sem devoluções nos próximos 7 dias." />
        ) : (
          <ul className="space-y-3">
            {returns.map(r => (
              <li
                key={r.id}
                className="flex items-center justify-between cursor-pointer hover:bg-muted rounded-md px-2 py-1 -mx-2 transition-colors"
                onClick={() => navigate(`/rentals/${r.id}`)}
              >
                <div>
                  <p className="text-sm font-medium">#{r.contractNumber}</p>
                  <p className="text-xs text-muted-foreground">{r.customerName}</p>
                </div>
                <p className="text-sm text-muted-foreground">{formatDate(r.expectedReturn)}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 3: Create `OverdueReturnsList.tsx`**

```tsx
import { useNavigate } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/feedback/EmptyState'
import { formatDate } from '@/lib/formatters'
import type { DashboardOverdueReturn } from '@/types'

interface Props {
  returns: DashboardOverdueReturn[]
}

export function OverdueReturnsList({ returns }: Props) {
  const navigate = useNavigate()

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base">Devoluções Atrasadas</CardTitle>
        <AlertTriangle className="h-4 w-4 text-orange-500" />
      </CardHeader>
      <CardContent>
        {returns.length === 0 ? (
          <EmptyState title="Tudo em dia" description="Nenhuma devolução atrasada." />
        ) : (
          <ul className="space-y-3">
            {returns.map(r => (
              <li
                key={r.id}
                className="flex items-center justify-between cursor-pointer hover:bg-muted rounded-md px-2 py-1 -mx-2 transition-colors"
                onClick={() => navigate(`/rentals/${r.id}`)}
              >
                <div>
                  <p className="text-sm font-medium">#{r.contractNumber}</p>
                  <p className="text-xs text-muted-foreground">{r.customerName} · venceu {formatDate(r.expectedReturn)}</p>
                </div>
                <Badge variant="destructive" className="text-xs">
                  {r.daysOverdue}d
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Compile check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/dashboard/components/RecentPaymentsList.tsx \
        frontend/src/features/dashboard/components/UpcomingReturnsList.tsx \
        frontend/src/features/dashboard/components/OverdueReturnsList.tsx
git commit -m "feat(dashboard): add list components (payments, upcoming/overdue returns)"
```

---

## Task 7: Frontend — DashboardPage + Tests (TDD)

**Files:**
- Create: `frontend/src/tests/dashboard/DashboardPage.test.tsx`
- Modify: `frontend/src/pages/DashboardPage.tsx`

- [ ] **Step 1: Write failing tests**

Create `frontend/src/tests/dashboard/DashboardPage.test.tsx`:

```tsx
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
    month: `2025-${String(12 + i - 5).padStart(2, '0')}`,
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
    await waitFor(() => expect(screen.getByText('#2026-0001')).toBeInTheDocument())
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend && source ~/.nvm/nvm.sh && nvm use 20.19.4 && npx vitest run src/tests/dashboard/DashboardPage.test.tsx 2>&1 | tail -10
```

Expected: all 10 tests fail (placeholder renders static content).

- [ ] **Step 3: Replace `frontend/src/pages/DashboardPage.tsx`**

```tsx
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/feedback/ErrorState'
import { useDashboardSummary } from '@/features/dashboard/hooks/useDashboardSummary'
import { FinancialSection } from '@/features/dashboard/components/FinancialSection'
import { RentalsSection } from '@/features/dashboard/components/RentalsSection'
import { InventorySection } from '@/features/dashboard/components/InventorySection'
import { RevenueBarChart } from '@/features/dashboard/components/RevenueBarChart'
import { CumulativeLineChart } from '@/features/dashboard/components/CumulativeLineChart'
import { RentalStatusPieChart } from '@/features/dashboard/components/RentalStatusPieChart'
import { InventoryOccupancyBar } from '@/features/dashboard/components/InventoryOccupancyBar'
import { RecentPaymentsList } from '@/features/dashboard/components/RecentPaymentsList'
import { UpcomingReturnsList } from '@/features/dashboard/components/UpcomingReturnsList'
import { OverdueReturnsList } from '@/features/dashboard/components/OverdueReturnsList'

export function DashboardPage() {
  const { data, isLoading, isError, refetch } = useDashboardSummary()

  if (isLoading) {
    return (
      <div className="space-y-6">
        <p className="text-muted-foreground">Carregando dashboard...</p>
        <div className="grid gap-4 grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <div className="grid gap-4 grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-72" />)}
        </div>
      </div>
    )
  }

  if (isError || !data) {
    return <ErrorState onRetry={() => refetch()} />
  }

  const { permissions, financial, rentals, inventory, monthlyHistory } = data

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold">Dashboard</h2>
        <p className="text-muted-foreground">
          Visão geral — {data.period.currentMonth}
        </p>
      </div>

      {/* KPI Sections */}
      <div className="space-y-6">
        {permissions.canViewFinancial && financial && (
          <FinancialSection data={financial} />
        )}
        {permissions.canViewOperational && (
          <RentalsSection data={rentals} />
        )}
        {permissions.canViewInventory && (
          <InventorySection data={inventory} />
        )}
      </div>

      {/* Charts */}
      <div className="grid gap-6 md:grid-cols-2">
        {permissions.canViewFinancial && (
          <RevenueBarChart data={monthlyHistory} />
        )}
        {permissions.canViewFinancial && (
          <CumulativeLineChart data={monthlyHistory} />
        )}
        {permissions.canViewOperationalCharts && (
          <RentalStatusPieChart data={rentals} />
        )}
        {permissions.canViewOperationalCharts && (
          <InventoryOccupancyBar data={inventory} />
        )}
      </div>

      {/* Lists */}
      <div className="grid gap-6 md:grid-cols-3">
        {permissions.canViewFinancial && financial && (
          <RecentPaymentsList payments={financial.recentPayments} />
        )}
        {permissions.canViewOperational && (
          <UpcomingReturnsList returns={rentals.upcomingReturns} />
        )}
        {permissions.canViewOperational && (
          <OverdueReturnsList returns={rentals.overdueReturns} />
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests — expect all to pass**

```bash
cd frontend && npx vitest run src/tests/dashboard/DashboardPage.test.tsx 2>&1 | tail -8
```

Expected: 10 passed.

- [ ] **Step 5: Run full frontend suite to confirm no regressions**

```bash
cd frontend && npx vitest run 2>&1 | tail -6
```

Expected: all tests pass (≥99 pre-existing + 10 new = ≥109 total).

- [ ] **Step 6: Compile check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/tests/dashboard/DashboardPage.test.tsx \
        frontend/src/pages/DashboardPage.tsx
git commit -m "feat(dashboard): implement DashboardPage with KPIs, charts and lists"
```

---

## Self-Review Checklist

- [x] `GET /dashboard/summary` — Task 1 ✓
- [x] `period` field in response — Task 1 (`buildPeriod`) ✓
- [x] `permissions` with 4 flags — Task 1 (`buildPermissions`) ✓
- [x] `financial = null` for attendant — Task 1 (conditional `Promise.resolve(null)`) ✓
- [x] `financial.recentPayments` with correct shape — Task 1 (`getFinancialData`) ✓
- [x] `totalIncome/Expense` ignore `isVoided=true` — Task 1 (where clause) ✓
- [x] `rentals.active` excludes overdue — Task 1 (`expectedReturn >= today`) ✓
- [x] `rentals.overdue` computed from `expectedReturn < today` — Task 1 ✓
- [x] `upcomingReturns` next 7 days — Task 1 ✓
- [x] `overdueReturns` with `daysOverdue` — Task 1 ✓
- [x] `occupancyRate = 0` when `totalItems = 0` — Task 1 ✓
- [x] `monthlyHistory` 6 fixed entries — Task 1 ✓
- [x] `cumulativeIncome` accumulates — Task 1 ✓
- [x] Recharts installed — Task 4 ✓
- [x] `EmptyState` when no data in charts — Tasks 5 ✓
- [x] Month labels formatted `Jan/26` style — Task 5 (`formatMonth`) ✓
- [x] Links to `/rentals/:id` in all lists — Task 6 ✓
- [x] RBAC by `permissions` flags in DashboardPage — Task 7 ✓
- [x] 10 frontend tests + 20 backend tests — Tasks 2 & 7 ✓
- [x] `formatCurrency`/`formatDate` used in components — Tasks 4-6 ✓
- [x] `retry: 1`, `staleTime: 5min`, `refetchOnWindowFocus: false` — Task 3 ✓
