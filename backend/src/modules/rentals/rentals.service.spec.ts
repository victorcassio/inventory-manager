import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PricingType, RentalStatus } from '@prisma/client';
import { RentalsService } from './rentals.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { AuditService } from '../audit/audit.service';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const today = new Date();
today.setHours(0, 0, 0, 0);

const yesterday = new Date(today);
yesterday.setDate(today.getDate() - 1);

const tomorrow = new Date(today);
tomorrow.setDate(today.getDate() + 1);

const nextWeek = new Date(today);
nextWeek.setDate(today.getDate() + 7);

const baseCustomer = { id: 'cust-1', name: 'Acme', isActive: true };

const baseItem = {
  id: 'item-1',
  code: 'AND-001',
  name: 'Andaime 1m',
  dailyRate: 15,
  availableQty: 10,
  rentedQty: 0,
  isActive: true,
};

const baseRental = {
  id: 'rental-1',
  customerId: 'cust-1',
  userId: 'user-1',
  contractNumber: '2026-0001',
  status: RentalStatus.active,
  startedAt: today,
  expectedReturn: nextWeek,
  returnedAt: null,
  pricingType: PricingType.daily,
  deposit: 0,
  discount: 0,
  lateFee: 0,
  extraCosts: 0,
  subtotal: 105,
  total: 105,
  paidAmount: 0,
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const baseRentalItem = {
  id: 'ri-1',
  rentalId: 'rental-1',
  itemId: 'item-1',
  quantity: 1,
  unitPrice: 15,
  returnedQty: 0,
};

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockPrisma = {
  customer: { findUnique: jest.fn() },
  contractCounter: { upsert: jest.fn(), update: jest.fn() },
  item: { findUnique: jest.fn() },
  rental: {
    create: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  rentalItem: { createMany: jest.fn() },
  $transaction: jest.fn(),
};

const mockInventoryService = {
  debitStock: jest.fn(),
  revertRentalStock: jest.fn(),
};

const mockAudit = { log: jest.fn() };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setupHappyPathCreate() {
  mockPrisma.customer.findUnique.mockResolvedValue(baseCustomer);
  mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
  mockPrisma.contractCounter.upsert.mockResolvedValue({});
  mockPrisma.contractCounter.update.mockResolvedValue({ year: 2026, lastSeq: 1 });
  mockPrisma.item.findUnique.mockResolvedValue(baseItem);
  mockPrisma.rental.create.mockResolvedValue(baseRental);
  mockPrisma.rentalItem.createMany.mockResolvedValue({ count: 1 });
  mockPrisma.rental.update.mockResolvedValue(baseRental);
  mockInventoryService.debitStock.mockResolvedValue(undefined);
  mockAudit.log.mockResolvedValue(undefined);
}

const validCreateDto = {
  customerId: 'cust-1',
  startDate: today.toISOString().slice(0, 10),
  expectedReturn: nextWeek.toISOString().slice(0, 10),
  items: [{ itemId: 'item-1', quantity: 1 }],
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('RentalsService', () => {
  let service: RentalsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RentalsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: InventoryService, useValue: mockInventoryService },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();
    service = module.get<RentalsService>(RentalsService);
  });

  // ─── createRental ─────────────────────────────────────────────────────────

  describe('createRental', () => {
    it('creates rental successfully', async () => {
      setupHappyPathCreate();
      const result = await service.createRental(validCreateDto, 'user-1');
      expect(result).toBeDefined();
      expect(mockPrisma.rental.create).toHaveBeenCalled();
    });

    it('generates contractNumber in YYYY-XXXX format', async () => {
      setupHappyPathCreate();
      await service.createRental(validCreateDto, 'user-1');
      const createCall = mockPrisma.rental.create.mock.calls[0][0];
      expect(createCall.data.contractNumber).toMatch(/^\d{4}-\d{4}$/);
    });

    it('creates RentalItems with unitPrice from item dailyRate', async () => {
      setupHappyPathCreate();
      await service.createRental(validCreateDto, 'user-1');
      expect(mockPrisma.rentalItem.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ unitPrice: 15, quantity: 1, itemId: 'item-1' }),
          ]),
        }),
      );
    });

    it('calls debitStock once per item', async () => {
      setupHappyPathCreate();
      await service.createRental(
        { ...validCreateDto, items: [{ itemId: 'item-1', quantity: 2 }] },
        'user-1',
      );
      expect(mockInventoryService.debitStock).toHaveBeenCalledTimes(1);
      expect(mockInventoryService.debitStock).toHaveBeenCalledWith(
        'item-1', 2, 'rental-1', 'user-1', mockPrisma,
      );
    });

    it('creates AuditLog with action create_rental', async () => {
      setupHappyPathCreate();
      await service.createRental(validCreateDto, 'user-1');
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'create_rental', entity: 'Rental' }),
        mockPrisma,
      );
    });

    it('throws BadRequestException when expectedReturn equals startDate', async () => {
      await expect(
        service.createRental(
          { ...validCreateDto, expectedReturn: validCreateDto.startDate },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when expectedReturn is before startDate', async () => {
      await expect(
        service.createRental(
          { ...validCreateDto, expectedReturn: yesterday.toISOString().slice(0, 10) },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when customer does not exist', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);
      await expect(service.createRental(validCreateDto, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when customer is inactive', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({ ...baseCustomer, isActive: false });
      await expect(service.createRental(validCreateDto, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when item does not exist', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(baseCustomer);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      mockPrisma.contractCounter.upsert.mockResolvedValue({});
      mockPrisma.contractCounter.update.mockResolvedValue({ year: 2026, lastSeq: 1 });
      mockPrisma.item.findUnique.mockResolvedValue(null);

      await expect(service.createRental(validCreateDto, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('propagates BadRequestException from debitStock when stock is insufficient', async () => {
      setupHappyPathCreate();
      mockInventoryService.debitStock.mockRejectedValue(
        new BadRequestException('Insufficient stock'),
      );
      await expect(service.createRental(validCreateDto, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── computedStatus ───────────────────────────────────────────────────────

  describe('computedStatus calculation', () => {
    it('returns computedStatus overdue when active rental has expired expectedReturn', () => {
      const rental = { ...baseRental, status: RentalStatus.active, expectedReturn: yesterday };
      const result = (service as any).enrichRental(rental);
      expect(result.computedStatus).toBe('overdue');
    });

    it('returns daysOverdue > 0 for overdue rentals', () => {
      const twoDaysAgo = new Date(today);
      twoDaysAgo.setDate(today.getDate() - 2);
      const rental = { ...baseRental, status: RentalStatus.active, expectedReturn: twoDaysAgo };
      const result = (service as any).enrichRental(rental);
      expect(result.daysOverdue).toBeGreaterThanOrEqual(2);
    });

    it('returns computedStatus active when rental is active and not expired', () => {
      const rental = { ...baseRental, status: RentalStatus.active, expectedReturn: nextWeek };
      const result = (service as any).enrichRental(rental);
      expect(result.computedStatus).toBe('active');
      expect(result.daysOverdue).toBe(0);
    });

    it('returns computedStatus returned for returned rentals', () => {
      const rental = { ...baseRental, status: RentalStatus.returned };
      const result = (service as any).enrichRental(rental);
      expect(result.computedStatus).toBe('returned');
      expect(result.daysOverdue).toBe(0);
    });
  });

  // ─── findRentalById ───────────────────────────────────────────────────────

  describe('findRentalById', () => {
    it('throws NotFoundException when rental does not exist', async () => {
      mockPrisma.rental.findUnique.mockResolvedValue(null);
      await expect(service.findRentalById('rental-1')).rejects.toThrow(NotFoundException);
    });

    it('calculates balanceAmount correctly', async () => {
      const rentalWithData = {
        ...baseRental,
        total: 300,
        lateFee: 30,
        paidAmount: 100,
        returns: [
          { returnItems: [{ damageFee: 50 }, { damageFee: 20 }] },
        ],
        payments: [],
        rentalItems: [baseRentalItem],
        customer: baseCustomer,
      };
      mockPrisma.rental.findUnique.mockResolvedValue(rentalWithData);

      const result = await service.findRentalById('rental-1');

      // balanceAmount = total(300) + lateFee(30) + damageFees(70) - paidAmount(100) = 300
      expect(result.balanceAmount).toBe(300);
    });
  });

  // ─── cancelRental ─────────────────────────────────────────────────────────

  describe('cancelRental', () => {
    function setupCancelRental(overrides = {}) {
      mockPrisma.rental.findUnique.mockResolvedValue({
        ...baseRental,
        rentalItems: [baseRentalItem],
        payments: [],
        returns: [],
        ...overrides,
      });
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      mockPrisma.rental.update.mockResolvedValue({ ...baseRental, status: RentalStatus.canceled });
      mockInventoryService.revertRentalStock.mockResolvedValue(undefined);
      mockAudit.log.mockResolvedValue(undefined);
    }

    it('cancels active rental and sets status to canceled', async () => {
      setupCancelRental();
      await service.cancelRental('rental-1', 'user-1');
      expect(mockPrisma.rental.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: RentalStatus.canceled }),
        }),
      );
    });

    it('calls revertRentalStock for each rentalItem', async () => {
      setupCancelRental();
      await service.cancelRental('rental-1', 'user-1');
      expect(mockInventoryService.revertRentalStock).toHaveBeenCalledTimes(1);
      expect(mockInventoryService.revertRentalStock).toHaveBeenCalledWith(
        'item-1', 1, 'rental-1', 'user-1', mockPrisma,
      );
    });

    it('creates AuditLog with action cancel_rental', async () => {
      setupCancelRental();
      await service.cancelRental('rental-1', 'user-1');
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'cancel_rental', entity: 'Rental' }),
        mockPrisma,
      );
    });

    it('throws NotFoundException when rental does not exist', async () => {
      mockPrisma.rental.findUnique.mockResolvedValue(null);
      await expect(service.cancelRental('rental-1', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when rental is already returned', async () => {
      setupCancelRental({ status: RentalStatus.returned });
      await expect(service.cancelRental('rental-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when rental is already canceled', async () => {
      setupCancelRental({ status: RentalStatus.canceled });
      await expect(service.cancelRental('rental-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when rental has registered payments', async () => {
      setupCancelRental({ payments: [{ id: 'payment-1' }] });
      await expect(service.cancelRental('rental-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when rental has registered returns', async () => {
      setupCancelRental({ returns: [{ id: 'return-1' }] });
      await expect(service.cancelRental('rental-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── updateRental ─────────────────────────────────────────────────────────

  describe('updateRental', () => {
    const rentalWithItems = {
      ...baseRental,
      rentalItems: [baseRentalItem],
    };

    it('updates only allowed fields and creates audit log', async () => {
      mockPrisma.rental.findUnique.mockResolvedValue(rentalWithItems);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      mockPrisma.rental.update.mockResolvedValue({
        ...baseRental,
        notes: 'Updated note',
      });

      await service.updateRental('rental-1', { notes: 'Updated note' }, 'user-1');

      expect(mockPrisma.rental.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ notes: 'Updated note' }),
        }),
      );
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'update_rental', entity: 'Rental' }),
        mockPrisma,
      );
    });

    it('does not change rentedQty or availableQty', async () => {
      mockPrisma.rental.findUnique.mockResolvedValue(rentalWithItems);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      mockPrisma.rental.update.mockResolvedValue(baseRental);

      await service.updateRental('rental-1', { discount: 10 }, 'user-1');

      expect(mockInventoryService.debitStock).not.toHaveBeenCalled();
      expect(mockInventoryService.revertRentalStock).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when rental does not exist', async () => {
      mockPrisma.rental.findUnique.mockResolvedValue(null);
      await expect(
        service.updateRental('rental-1', { notes: 'x' }, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
