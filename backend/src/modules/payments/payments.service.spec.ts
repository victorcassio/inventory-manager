import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  FinancialTransactionCategory,
  FinancialTransactionOrigin,
  FinancialTransactionType,
  PaymentMethod,
  RentalStatus,
} from '@prisma/client';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeRental(overrides: any = {}) {
  return {
    id: 'rental-1',
    contractNumber: '2026-0001',
    status: RentalStatus.active,
    total: 300,
    lateFee: 0,
    paidAmount: 0,
    returns: [],
    ...overrides,
  };
}

const basePayment = {
  id: 'payment-1',
  rentalId: 'rental-1',
  userId: 'user-1',
  amount: 100,
  method: PaymentMethod.pix,
  paidAt: new Date(),
  referenceCode: null,
  notes: null,
  createdAt: new Date(),
};

const baseFinancialTransaction = {
  id: 'ft-1',
  rentalId: 'rental-1',
  paymentId: 'payment-1',
  type: FinancialTransactionType.income,
  category: FinancialTransactionCategory.rental_income,
  origin: FinancialTransactionOrigin.payment,
  amount: 100,
  description: 'Rental payment — 2026-0001',
  date: new Date(),
};

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  rental: { findUnique: jest.fn(), update: jest.fn() },
  payment: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  financialTransaction: { create: jest.fn() },
  $transaction: jest.fn(),
};

const mockAudit = { log: jest.fn() };

// ─── Setup helper ─────────────────────────────────────────────────────────────

function setupHappyPath(rentalOverrides: any = {}) {
  mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
  mockPrisma.rental.findUnique.mockResolvedValue(makeRental(rentalOverrides));
  mockPrisma.payment.create.mockResolvedValue(basePayment);
  mockPrisma.rental.update.mockResolvedValue({});
  mockPrisma.financialTransaction.create.mockResolvedValue(baseFinancialTransaction);
  mockAudit.log.mockResolvedValue(undefined);
}

const validDto = { amount: 100, method: PaymentMethod.pix };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PaymentsService', () => {
  let service: PaymentsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();
    service = module.get<PaymentsService>(PaymentsService);
  });

  // ─── registerPayment ──────────────────────────────────────────────────────

  describe('registerPayment', () => {
    it('registers a payment successfully', async () => {
      setupHappyPath();
      const result = await service.registerPayment('rental-1', validDto, 'user-1');
      expect(result).toBeDefined();
      expect(mockPrisma.payment.create).toHaveBeenCalled();
    });

    it('allows a partial payment (amount less than balance)', async () => {
      setupHappyPath({ total: 300 });
      await service.registerPayment('rental-1', { amount: 50, method: PaymentMethod.cash }, 'user-1');
      expect(mockPrisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ amount: 50 }) }),
      );
    });

    it('allows multiple payments for the same rental when balance remains', async () => {
      // Simulate rental already with 100 paid → balance = 300 - 100 = 200
      setupHappyPath({ total: 300, paidAmount: 100 });
      await service.registerPayment('rental-1', { amount: 50, method: PaymentMethod.cash }, 'user-1');
      expect(mockPrisma.payment.create).toHaveBeenCalled();
    });

    it('increments Rental.paidAmount by the payment amount', async () => {
      setupHappyPath();
      await service.registerPayment('rental-1', validDto, 'user-1');
      expect(mockPrisma.rental.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rental-1' },
          data: { paidAmount: { increment: 100 } },
        }),
      );
    });

    it('calculates balanceAmount as total + lateFee + damageFees - paidAmount', async () => {
      // total=300, lateFee=60, damageFees=0, paidAmount=0 → balance=360
      // Payment of 360 should succeed; 361 should fail
      setupHappyPath({ total: 300, lateFee: 60 });
      await service.registerPayment('rental-1', { amount: 360, method: PaymentMethod.cash }, 'user-1');
      expect(mockPrisma.payment.create).toHaveBeenCalled();
    });

    it('includes rental.total in balanceAmount', async () => {
      setupHappyPath({ total: 200, lateFee: 0, paidAmount: 0, returns: [] });
      await service.registerPayment('rental-1', { amount: 200, method: PaymentMethod.cash }, 'user-1');
      expect(mockPrisma.payment.create).toHaveBeenCalled();
    });

    it('includes rental.lateFee in balanceAmount', async () => {
      // total=100, lateFee=40, paidAmount=0 → balance=140
      setupHappyPath({ total: 100, lateFee: 40 });
      await service.registerPayment('rental-1', { amount: 140, method: PaymentMethod.cash }, 'user-1');
      expect(mockPrisma.payment.create).toHaveBeenCalled();
    });

    it('includes totalDamageFees from returnItems in balanceAmount', async () => {
      // total=200, lateFee=0, damageFees=50+20=70, paidAmount=0 → balance=270
      setupHappyPath({
        total: 200,
        lateFee: 0,
        returns: [{ returnItems: [{ damageFee: 50 }, { damageFee: 20 }] }],
      });
      await service.registerPayment('rental-1', { amount: 270, method: PaymentMethod.cash }, 'user-1');
      expect(mockPrisma.payment.create).toHaveBeenCalled();
    });

    it('creates FinancialTransaction with origin=payment', async () => {
      setupHappyPath();
      await service.registerPayment('rental-1', validDto, 'user-1');
      expect(mockPrisma.financialTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ origin: FinancialTransactionOrigin.payment }),
        }),
      );
    });

    it('creates FinancialTransaction with type=income', async () => {
      setupHappyPath();
      await service.registerPayment('rental-1', validDto, 'user-1');
      expect(mockPrisma.financialTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: FinancialTransactionType.income }),
        }),
      );
    });

    it('creates FinancialTransaction with category=rental_income', async () => {
      setupHappyPath();
      await service.registerPayment('rental-1', validDto, 'user-1');
      expect(mockPrisma.financialTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ category: FinancialTransactionCategory.rental_income }),
        }),
      );
    });

    it('creates AuditLog with action register_payment', async () => {
      setupHappyPath();
      await service.registerPayment('rental-1', validDto, 'user-1');
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'register_payment', entity: 'Payment' }),
        mockPrisma,
      );
    });

    // ─── Failures ──────────────────────────────────────────────────────────

    it('throws NotFoundException when rental does not exist', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      mockPrisma.rental.findUnique.mockResolvedValue(null);
      await expect(service.registerPayment('rental-1', validDto, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when rental is canceled', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      mockPrisma.rental.findUnique.mockResolvedValue(makeRental({ status: RentalStatus.canceled }));
      await expect(service.registerPayment('rental-1', validDto, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('allows payment when rental is active', async () => {
      setupHappyPath({ status: RentalStatus.active });
      await expect(
        service.registerPayment('rental-1', validDto, 'user-1'),
      ).resolves.toBeDefined();
    });

    it('allows payment when rental is returned', async () => {
      setupHappyPath({ status: RentalStatus.returned, total: 300 });
      await expect(
        service.registerPayment('rental-1', validDto, 'user-1'),
      ).resolves.toBeDefined();
    });

    it('throws BadRequestException when amount is 0', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      mockPrisma.rental.findUnique.mockResolvedValue(makeRental());
      await expect(
        service.registerPayment('rental-1', { amount: 0, method: PaymentMethod.cash }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when amount exceeds balance', async () => {
      // total=100, lateFee=0, paidAmount=0 → balance=100; payment=101 → fail
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      mockPrisma.rental.findUnique.mockResolvedValue(makeRental({ total: 100 }));
      await expect(
        service.registerPayment('rental-1', { amount: 101, method: PaymentMethod.cash }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── getPaymentsByRental ──────────────────────────────────────────────────

  describe('getPaymentsByRental', () => {
    it('returns payments for the rental', async () => {
      mockPrisma.rental.findUnique.mockResolvedValue(makeRental());
      mockPrisma.payment.findMany.mockResolvedValue([basePayment]);
      const result = await service.getPaymentsByRental('rental-1');
      expect(result).toHaveLength(1);
    });

    it('throws NotFoundException when rental does not exist', async () => {
      mockPrisma.rental.findUnique.mockResolvedValue(null);
      await expect(service.getPaymentsByRental('rental-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── getPaymentById ───────────────────────────────────────────────────────

  describe('getPaymentById', () => {
    it('returns full payment detail', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue({
        ...basePayment,
        rental: makeRental(),
        financialTransactions: [baseFinancialTransaction],
      });
      const result = await service.getPaymentById('payment-1');
      expect(result.id).toBe('payment-1');
    });

    it('throws NotFoundException when payment does not exist', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue(null);
      await expect(service.getPaymentById('payment-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── listPayments ─────────────────────────────────────────────────────────

  describe('listPayments', () => {
    beforeEach(() => {
      mockPrisma.payment.findMany.mockResolvedValue([basePayment]);
      mockPrisma.payment.count.mockResolvedValue(1);
    });

    it('applies method filter', async () => {
      await service.listPayments({ method: PaymentMethod.pix });
      expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ method: PaymentMethod.pix }),
        }),
      );
    });

    it('applies dateFrom filter', async () => {
      const dateFrom = '2026-05-01';
      await service.listPayments({ dateFrom });
      expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            paidAt: expect.objectContaining({ gte: expect.any(Date) }),
          }),
        }),
      );
    });

    it('applies customerId filter via rental relation', async () => {
      await service.listPayments({ customerId: 'cust-1' });
      expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            rental: expect.objectContaining({ customerId: 'cust-1' }),
          }),
        }),
      );
    });

    it('returns paginated result with correct shape', async () => {
      const result = await service.listPayments({ page: 1, limit: 10 });
      expect(result).toMatchObject({ data: expect.any(Array), total: 1, page: 1, limit: 10 });
    });
  });
});
