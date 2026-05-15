import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  FinancialTransactionCategory,
  FinancialTransactionOrigin,
  FinancialTransactionType,
  PaymentMethod,
} from '@prisma/client';
import { FinancialService } from './financial.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const manualTransaction = {
  id: 'ft-1',
  userId: 'user-1',
  rentalId: null,
  paymentId: null,
  type: FinancialTransactionType.income,
  category: FinancialTransactionCategory.other,
  origin: FinancialTransactionOrigin.manual,
  amount: '100.00',
  description: 'Manual expense',
  date: new Date('2026-05-15'),
  isVoided: false,
  voidedAt: null,
  voidedById: null,
  voidReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const paymentTransaction = {
  ...manualTransaction,
  id: 'ft-2',
  origin: FinancialTransactionOrigin.payment,
  paymentId: 'payment-1',
  category: FinancialTransactionCategory.rental_income,
};

const validCreateDto = {
  type: FinancialTransactionType.expense,
  category: FinancialTransactionCategory.maintenance,
  amount: 200,
  description: 'Equipment maintenance',
  transactionDate: '2026-05-15',
};

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  rental: { findUnique: jest.fn() },
  financialTransaction: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockAudit = { log: jest.fn() };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FinancialService', () => {
  let service: FinancialService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinancialService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();
    service = module.get<FinancialService>(FinancialService);
  });

  // ─── createManualTransaction ──────────────────────────────────────────────

  describe('createManualTransaction', () => {
    it('creates manual transaction successfully', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      mockPrisma.financialTransaction.create.mockResolvedValue(manualTransaction);
      mockAudit.log.mockResolvedValue(undefined);

      const result = await service.createManualTransaction(validCreateDto, 'user-1');
      expect(result).toBeDefined();
      expect(mockPrisma.financialTransaction.create).toHaveBeenCalled();
    });

    it('always forces origin to manual regardless of any input', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      mockPrisma.financialTransaction.create.mockResolvedValue(manualTransaction);
      mockAudit.log.mockResolvedValue(undefined);

      await service.createManualTransaction(validCreateDto, 'user-1');

      expect(mockPrisma.financialTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ origin: FinancialTransactionOrigin.manual }),
        }),
      );
    });

    it('throws BadRequestException when amount is 0 or negative', async () => {
      await expect(
        service.createManualTransaction({ ...validCreateDto, amount: 0 }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when rentalId does not exist', async () => {
      mockPrisma.rental.findUnique.mockResolvedValue(null);
      await expect(
        service.createManualTransaction({ ...validCreateDto, rentalId: 'nonexistent' }, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates AuditLog with action create_financial_transaction', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      mockPrisma.financialTransaction.create.mockResolvedValue(manualTransaction);
      mockAudit.log.mockResolvedValue(undefined);

      await service.createManualTransaction(validCreateDto, 'user-1');

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'create_financial_transaction' }),
        mockPrisma,
      );
    });
  });

  // ─── listTransactions ─────────────────────────────────────────────────────

  describe('listTransactions', () => {
    beforeEach(() => {
      mockPrisma.financialTransaction.findMany.mockResolvedValue([manualTransaction]);
      mockPrisma.financialTransaction.count.mockResolvedValue(1);
    });

    it('returns paginated list of transactions', async () => {
      const result = await service.listTransactions({});
      expect(result).toMatchObject({ data: expect.any(Array), total: 1 });
    });

    it('filters by type', async () => {
      await service.listTransactions({ type: FinancialTransactionType.income });
      expect(mockPrisma.financialTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: FinancialTransactionType.income }),
        }),
      );
    });

    it('filters by category', async () => {
      await service.listTransactions({ category: FinancialTransactionCategory.maintenance });
      expect(mockPrisma.financialTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ category: FinancialTransactionCategory.maintenance }),
        }),
      );
    });

    it('filters by origin', async () => {
      await service.listTransactions({ origin: FinancialTransactionOrigin.payment });
      expect(mockPrisma.financialTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ origin: FinancialTransactionOrigin.payment }),
        }),
      );
    });

    it('filters by isVoided when explicitly provided', async () => {
      await service.listTransactions({ isVoided: true });
      expect(mockPrisma.financialTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isVoided: true }),
        }),
      );
    });

    it('defaults isVoided to false when not provided', async () => {
      await service.listTransactions({});
      expect(mockPrisma.financialTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isVoided: false }),
        }),
      );
    });

    it('filters by rentalId', async () => {
      await service.listTransactions({ rentalId: 'rental-1' });
      expect(mockPrisma.financialTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ rentalId: 'rental-1' }),
        }),
      );
    });

    it('filters by paymentId', async () => {
      await service.listTransactions({ paymentId: 'payment-1' });
      expect(mockPrisma.financialTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ paymentId: 'payment-1' }),
        }),
      );
    });

    it('filters by dateFrom and dateTo', async () => {
      await service.listTransactions({ dateFrom: '2026-05-01', dateTo: '2026-05-31' });
      expect(mockPrisma.financialTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            date: expect.objectContaining({
              gte: expect.any(Date),
              lte: expect.any(Date),
            }),
          }),
        }),
      );
    });
  });

  // ─── getTransactionById ───────────────────────────────────────────────────

  describe('getTransactionById', () => {
    it('returns full transaction detail', async () => {
      mockPrisma.financialTransaction.findUnique.mockResolvedValue(manualTransaction);
      const result = await service.getTransactionById('ft-1');
      expect(result.id).toBe('ft-1');
    });

    it('throws NotFoundException when transaction does not exist', async () => {
      mockPrisma.financialTransaction.findUnique.mockResolvedValue(null);
      await expect(service.getTransactionById('ft-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── updateManualTransaction ──────────────────────────────────────────────

  describe('updateManualTransaction', () => {
    it('updates a manual transaction successfully', async () => {
      mockPrisma.financialTransaction.findUnique.mockResolvedValue(manualTransaction);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      mockPrisma.financialTransaction.update.mockResolvedValue({
        ...manualTransaction,
        description: 'Updated',
      });
      mockAudit.log.mockResolvedValue(undefined);

      const result = await service.updateManualTransaction(
        'ft-1',
        { description: 'Updated' },
        'user-1',
      );
      expect(result.description).toBe('Updated');
    });

    it('throws BadRequestException when origin is payment', async () => {
      mockPrisma.financialTransaction.findUnique.mockResolvedValue(paymentTransaction);
      await expect(
        service.updateManualTransaction('ft-2', { description: 'x' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when transaction is voided', async () => {
      mockPrisma.financialTransaction.findUnique.mockResolvedValue({
        ...manualTransaction,
        isVoided: true,
      });
      await expect(
        service.updateManualTransaction('ft-1', { description: 'x' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('does not allow changing origin field', async () => {
      mockPrisma.financialTransaction.findUnique.mockResolvedValue(manualTransaction);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      mockPrisma.financialTransaction.update.mockResolvedValue(manualTransaction);
      mockAudit.log.mockResolvedValue(undefined);

      await service.updateManualTransaction('ft-1', { description: 'x' }, 'user-1');

      const updateCall = mockPrisma.financialTransaction.update.mock.calls[0][0];
      expect(updateCall.data.origin).toBeUndefined();
    });

    it('does not allow changing paymentId field', async () => {
      mockPrisma.financialTransaction.findUnique.mockResolvedValue(manualTransaction);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      mockPrisma.financialTransaction.update.mockResolvedValue(manualTransaction);
      mockAudit.log.mockResolvedValue(undefined);

      await service.updateManualTransaction('ft-1', { description: 'x' }, 'user-1');

      const updateCall = mockPrisma.financialTransaction.update.mock.calls[0][0];
      expect(updateCall.data.paymentId).toBeUndefined();
    });

    it('creates AuditLog with action update_financial_transaction', async () => {
      mockPrisma.financialTransaction.findUnique.mockResolvedValue(manualTransaction);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      mockPrisma.financialTransaction.update.mockResolvedValue(manualTransaction);
      mockAudit.log.mockResolvedValue(undefined);

      await service.updateManualTransaction('ft-1', { description: 'x' }, 'user-1');

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'update_financial_transaction' }),
        mockPrisma,
      );
    });
  });

  // ─── voidManualTransaction ────────────────────────────────────────────────

  describe('voidManualTransaction', () => {
    it('marks transaction as isVoided = true', async () => {
      mockPrisma.financialTransaction.findUnique.mockResolvedValue(manualTransaction);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      mockPrisma.financialTransaction.update.mockResolvedValue({
        ...manualTransaction,
        isVoided: true,
      });
      mockAudit.log.mockResolvedValue(undefined);

      await service.voidManualTransaction('ft-1', { reason: 'Error' }, 'user-1');

      expect(mockPrisma.financialTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isVoided: true }),
        }),
      );
    });

    it('throws BadRequestException when origin is payment', async () => {
      mockPrisma.financialTransaction.findUnique.mockResolvedValue(paymentTransaction);
      await expect(
        service.voidManualTransaction('ft-2', { reason: 'x' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when transaction is already voided', async () => {
      mockPrisma.financialTransaction.findUnique.mockResolvedValue({
        ...manualTransaction,
        isVoided: true,
      });
      await expect(
        service.voidManualTransaction('ft-1', { reason: 'x' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates AuditLog with action void_financial_transaction', async () => {
      mockPrisma.financialTransaction.findUnique.mockResolvedValue(manualTransaction);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      mockPrisma.financialTransaction.update.mockResolvedValue({
        ...manualTransaction,
        isVoided: true,
      });
      mockAudit.log.mockResolvedValue(undefined);

      await service.voidManualTransaction('ft-1', { reason: 'Error' }, 'user-1');

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'void_financial_transaction' }),
        mockPrisma,
      );
    });
  });
});
