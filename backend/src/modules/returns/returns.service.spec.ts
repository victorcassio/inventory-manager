import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InventoryMovementType, RentalStatus, ReturnItemCondition } from '@prisma/client';
import { ReturnsService } from './returns.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { AuditService } from '../audit/audit.service';

// ─── Date fixtures ────────────────────────────────────────────────────────────

const today = new Date();
today.setHours(0, 0, 0, 0);

const fourDaysAgo = new Date(today);
fourDaysAgo.setDate(today.getDate() - 4);

const nextWeek = new Date(today);
nextWeek.setDate(today.getDate() + 7);

// ─── Model fixtures ───────────────────────────────────────────────────────────

const baseRentalItem = {
  id: 'ri-1',
  rentalId: 'rental-1',
  itemId: 'item-1',
  quantity: 3,
  unitPrice: 15,
  returnedQty: 0,
};

const baseRental = {
  id: 'rental-1',
  status: RentalStatus.active,
  expectedReturn: nextWeek,
  startedAt: today,
  lateFee: 0,
  paidAmount: 0,
  rentalItems: [baseRentalItem],
};

const baseReturnRecord = {
  id: 'return-1',
  rentalId: 'rental-1',
  userId: 'user-1',
  isPartial: true,
  lateDays: 0,
  lateFee: 0,
  notes: null,
  returnedAt: today,
  createdAt: today,
};

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  rental: { findUnique: jest.fn(), update: jest.fn() },
  rentalItem: { update: jest.fn(), findMany: jest.fn() },
  return: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
  returnItem: { create: jest.fn() },
  $transaction: jest.fn(),
};

const mockInventoryService = { creditStock: jest.fn() };
const mockAudit = { log: jest.fn() };

// ─── Setup helpers ────────────────────────────────────────────────────────────

function setupPartialReturn(rentalOverrides: any = {}, itemOverrides: any = {}) {
  const rentalItem = { ...baseRentalItem, ...itemOverrides };
  mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
  mockPrisma.rental.findUnique.mockResolvedValue({
    ...baseRental,
    ...rentalOverrides,
    rentalItems: [rentalItem],
  });
  mockPrisma.return.create.mockResolvedValue({ ...baseReturnRecord, isPartial: true });
  mockPrisma.returnItem.create.mockResolvedValue({});
  mockPrisma.rentalItem.update.mockResolvedValue({});
  mockInventoryService.creditStock.mockResolvedValue(undefined);
  // After updates: still 1 of 3 returned → partial
  mockPrisma.rentalItem.findMany.mockResolvedValue([{ ...rentalItem, returnedQty: 1 }]);
  mockPrisma.return.update.mockResolvedValue({ ...baseReturnRecord, isPartial: true });
  mockPrisma.rental.update.mockResolvedValue({});
  mockAudit.log.mockResolvedValue(undefined);
}

function setupFullReturn() {
  const rentalItem = { ...baseRentalItem, quantity: 2, returnedQty: 0 };
  mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
  mockPrisma.rental.findUnique.mockResolvedValue({
    ...baseRental,
    rentalItems: [rentalItem],
  });
  mockPrisma.return.create.mockResolvedValue({ ...baseReturnRecord, isPartial: false });
  mockPrisma.returnItem.create.mockResolvedValue({});
  mockPrisma.rentalItem.update.mockResolvedValue({});
  mockInventoryService.creditStock.mockResolvedValue(undefined);
  // After updates: all 2 of 2 returned → total
  mockPrisma.rentalItem.findMany.mockResolvedValue([{ ...rentalItem, returnedQty: 2 }]);
  mockPrisma.return.update.mockResolvedValue({ ...baseReturnRecord, isPartial: false });
  mockPrisma.rental.update.mockResolvedValue({});
  mockAudit.log.mockResolvedValue(undefined);
}

const partialDto = {
  items: [{ rentalItemId: 'ri-1', quantity: 1, condition: ReturnItemCondition.good }],
};

const fullDto = {
  items: [{ rentalItemId: 'ri-1', quantity: 2, condition: ReturnItemCondition.good }],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ReturnsService', () => {
  let service: ReturnsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReturnsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: InventoryService, useValue: mockInventoryService },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();
    service = module.get<ReturnsService>(ReturnsService);
  });

  // ─── registerReturn ───────────────────────────────────────────────────────

  describe('registerReturn', () => {
    it('registers a partial return successfully', async () => {
      setupPartialReturn();
      const result = await service.registerReturn('rental-1', partialDto, 'user-1');
      expect(result).toBeDefined();
      expect(mockPrisma.return.create).toHaveBeenCalled();
    });

    it('registers a full return successfully', async () => {
      setupFullReturn();
      const result = await service.registerReturn('rental-1', fullDto, 'user-1');
      expect(result).toBeDefined();
    });

    it('keeps rental status active on partial return', async () => {
      setupPartialReturn();
      await service.registerReturn('rental-1', partialDto, 'user-1');
      const rentalUpdateCall = mockPrisma.rental.update.mock.calls.find(
        (c: any) => c[0]?.where?.id === 'rental-1',
      );
      expect(rentalUpdateCall?.[0]?.data?.status).toBeUndefined();
    });

    it('changes rental status to returned on full return', async () => {
      setupFullReturn();
      await service.registerReturn('rental-1', fullDto, 'user-1');
      expect(mockPrisma.rental.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: RentalStatus.returned }),
        }),
      );
    });

    it('sets rental.returnedAt on full return', async () => {
      setupFullReturn();
      await service.registerReturn('rental-1', fullDto, 'user-1');
      expect(mockPrisma.rental.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ returnedAt: expect.any(Date) }),
        }),
      );
    });

    it('sets isPartial on the Return record via backend calculation', async () => {
      setupPartialReturn();
      await service.registerReturn('rental-1', partialDto, 'user-1');
      // Return.update is called with the backend-computed isPartial
      expect(mockPrisma.return.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isPartial: true }) }),
      );
    });

    it('updates RentalItem.returnedQty by the returned quantity', async () => {
      setupPartialReturn();
      await service.registerReturn('rental-1', partialDto, 'user-1');
      expect(mockPrisma.rentalItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ri-1' },
          data: { returnedQty: { increment: 1 } },
        }),
      );
    });

    it('calls creditStock with rental_return for condition good', async () => {
      setupPartialReturn();
      await service.registerReturn('rental-1', partialDto, 'user-1');
      expect(mockInventoryService.creditStock).toHaveBeenCalledWith(
        'item-1', 1, InventoryMovementType.rental_return, 'rental-1', 'user-1', mockPrisma,
      );
    });

    it('calls creditStock with maintenance_in for condition damaged', async () => {
      setupPartialReturn();
      await service.registerReturn('rental-1', {
        items: [{ rentalItemId: 'ri-1', quantity: 1, condition: ReturnItemCondition.damaged, damageFee: 100 }],
      }, 'user-1');
      expect(mockInventoryService.creditStock).toHaveBeenCalledWith(
        'item-1', 1, InventoryMovementType.maintenance_in, 'rental-1', 'user-1', mockPrisma,
      );
    });

    it('calls creditStock with deactivation for condition lost', async () => {
      setupPartialReturn();
      await service.registerReturn('rental-1', {
        items: [{ rentalItemId: 'ri-1', quantity: 1, condition: ReturnItemCondition.lost, damageFee: 200 }],
      }, 'user-1');
      expect(mockInventoryService.creditStock).toHaveBeenCalledWith(
        'item-1', 1, InventoryMovementType.deactivation, 'rental-1', 'user-1', mockPrisma,
      );
    });

    it('calculates lateDays correctly when returning late', async () => {
      // Rental expected 4 days ago → lateDays = 4
      setupPartialReturn({ expectedReturn: fourDaysAgo });
      await service.registerReturn('rental-1', partialDto, 'user-1');
      expect(mockPrisma.return.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lateDays: 4 }),
        }),
      );
    });

    it('calculates lateFee only for items in this return (lateDays × qty × unitPrice)', async () => {
      // 4 days late, qty=1, unitPrice=15 → lateFee = 60
      setupPartialReturn({ expectedReturn: fourDaysAgo });
      await service.registerReturn('rental-1', partialDto, 'user-1');
      expect(mockPrisma.return.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lateFee: 60 }),
        }),
      );
    });

    it('accumulates lateFee in Rental.lateFee', async () => {
      setupPartialReturn({ expectedReturn: fourDaysAgo });
      await service.registerReturn('rental-1', partialDto, 'user-1');
      expect(mockPrisma.rental.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lateFee: { increment: 60 } }),
        }),
      );
    });

    it('creates AuditLog with action register_return', async () => {
      setupPartialReturn();
      await service.registerReturn('rental-1', partialDto, 'user-1');
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'register_return',
          entity: 'Return',
        }),
        mockPrisma,
      );
    });

    // ─── Failures ─────────────────────────────────────────────────────────

    it('throws NotFoundException when rental does not exist', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      mockPrisma.rental.findUnique.mockResolvedValue(null);
      await expect(service.registerReturn('rental-1', partialDto, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when rental status is returned', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      mockPrisma.rental.findUnique.mockResolvedValue({
        ...baseRental,
        status: RentalStatus.returned,
      });
      await expect(service.registerReturn('rental-1', partialDto, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when rental status is canceled', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      mockPrisma.rental.findUnique.mockResolvedValue({
        ...baseRental,
        status: RentalStatus.canceled,
      });
      await expect(service.registerReturn('rental-1', partialDto, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when rentalItemId does not belong to this rental', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      mockPrisma.rental.findUnique.mockResolvedValue({ ...baseRental, rentalItems: [] });
      await expect(
        service.registerReturn('rental-1', { items: [{ rentalItemId: 'ri-other', quantity: 1, condition: ReturnItemCondition.good }] }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when quantity exceeds pending quantity', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      mockPrisma.rental.findUnique.mockResolvedValue({
        ...baseRental,
        rentalItems: [{ ...baseRentalItem, quantity: 2, returnedQty: 1 }], // only 1 pending
      });
      await expect(
        service.registerReturn('rental-1', { items: [{ rentalItemId: 'ri-1', quantity: 2, condition: ReturnItemCondition.good }] }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when condition is good but damageFee > 0', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      mockPrisma.rental.findUnique.mockResolvedValue(baseRental);
      await expect(
        service.registerReturn('rental-1', {
          items: [{ rentalItemId: 'ri-1', quantity: 1, condition: ReturnItemCondition.good, damageFee: 50 }],
        }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when condition is damaged but damageFee is missing', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      mockPrisma.rental.findUnique.mockResolvedValue(baseRental);
      await expect(
        service.registerReturn('rental-1', {
          items: [{ rentalItemId: 'ri-1', quantity: 1, condition: ReturnItemCondition.damaged }],
        }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when condition is lost but damageFee is missing', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      mockPrisma.rental.findUnique.mockResolvedValue(baseRental);
      await expect(
        service.registerReturn('rental-1', {
          items: [{ rentalItemId: 'ri-1', quantity: 1, condition: ReturnItemCondition.lost }],
        }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── getReturnsByRental ───────────────────────────────────────────────────

  describe('getReturnsByRental', () => {
    it('returns list of returns for the rental', async () => {
      mockPrisma.rental.findUnique.mockResolvedValue(baseRental);
      mockPrisma.return.findMany.mockResolvedValue([baseReturnRecord]);
      const result = await service.getReturnsByRental('rental-1');
      expect(result).toHaveLength(1);
    });

    it('throws NotFoundException when rental does not exist', async () => {
      mockPrisma.rental.findUnique.mockResolvedValue(null);
      await expect(service.getReturnsByRental('rental-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── getReturnById ────────────────────────────────────────────────────────

  describe('getReturnById', () => {
    it('returns full return detail', async () => {
      mockPrisma.return.findUnique.mockResolvedValue({ ...baseReturnRecord, returnItems: [] });
      const result = await service.getReturnById('return-1');
      expect(result).toBeDefined();
      expect(result.id).toBe('return-1');
    });

    it('throws NotFoundException when return does not exist', async () => {
      mockPrisma.return.findUnique.mockResolvedValue(null);
      await expect(service.getReturnById('return-1')).rejects.toThrow(NotFoundException);
    });
  });
});
