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
