import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ItemCondition, InventoryMovementType } from '@prisma/client';
import { InventoryService } from './inventory.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const baseCategory = {
  id: 'cat-1',
  name: 'Andaimes',
  description: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const baseItem = {
  id: 'item-1',
  categoryId: 'cat-1',
  name: 'Andaime 1m',
  description: null,
  code: 'AND-001',
  dailyRate: '15.00',
  totalQty: 10,
  availableQty: 10,
  rentedQty: 0,
  maintenanceQty: 0,
  condition: ItemCondition.good,
  notes: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockPrisma = {
  itemCategory: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  item: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  inventoryMovement: { create: jest.fn() },
  rental: { findFirst: jest.fn() },
  $transaction: jest.fn(),
};

const mockAudit = { log: jest.fn() };

describe('InventoryService', () => {
  let service: InventoryService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();
    service = module.get<InventoryService>(InventoryService);
  });

  // ─── Categories ───────────────────────────────────────────────────────────

  describe('createCategory', () => {
    it('creates a category and logs audit', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      mockPrisma.itemCategory.create.mockResolvedValue(baseCategory);

      await service.createCategory({ name: 'Andaimes' }, 'user-1');

      expect(mockPrisma.itemCategory.create).toHaveBeenCalled();
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'create_category' }),
        mockPrisma,
      );
    });
  });

  describe('findCategoryById', () => {
    it('returns category when found', async () => {
      mockPrisma.itemCategory.findUnique.mockResolvedValue(baseCategory);
      const result = await service.findCategoryById('cat-1');
      expect(result).toEqual(baseCategory);
    });

    it('throws NotFoundException when not found', async () => {
      mockPrisma.itemCategory.findUnique.mockResolvedValue(null);
      await expect(service.findCategoryById('cat-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('deactivateCategory', () => {
    it('throws ConflictException when category has active items', async () => {
      mockPrisma.itemCategory.findUnique.mockResolvedValue(baseCategory);
      mockPrisma.item.findFirst.mockResolvedValue(baseItem);

      await expect(service.deactivateCategory('cat-1', 'user-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ─── Items ────────────────────────────────────────────────────────────────

  describe('createItem', () => {
    it('creates item with availableQty equal to totalQty', async () => {
      mockPrisma.item.findUnique.mockResolvedValue(null);
      mockPrisma.itemCategory.findUnique.mockResolvedValue(baseCategory);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      mockPrisma.item.create.mockResolvedValue(baseItem);

      await service.createItem(
        { categoryId: 'cat-1', name: 'Andaime 1m', code: 'AND-001', dailyRate: 15, totalQty: 10 },
        'user-1',
      );

      expect(mockPrisma.item.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ availableQty: 10, rentedQty: 0 }),
        }),
      );
    });

    it('throws ConflictException when item code already exists', async () => {
      mockPrisma.item.findUnique.mockResolvedValue(baseItem);

      await expect(
        service.createItem(
          { categoryId: 'cat-1', name: 'X', code: 'AND-001', dailyRate: 10, totalQty: 1 },
          'user-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('creates initial_stock InventoryMovement', async () => {
      mockPrisma.item.findUnique.mockResolvedValue(null);
      mockPrisma.itemCategory.findUnique.mockResolvedValue(baseCategory);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      mockPrisma.item.create.mockResolvedValue(baseItem);
      mockPrisma.inventoryMovement.create.mockResolvedValue({});

      await service.createItem(
        { categoryId: 'cat-1', name: 'Andaime 1m', code: 'AND-001', dailyRate: 15, totalQty: 10 },
        'user-1',
      );

      expect(mockPrisma.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: InventoryMovementType.initial_stock }),
        }),
      );
    });
  });

  describe('findItemById', () => {
    it('throws NotFoundException when item does not exist', async () => {
      mockPrisma.item.findUnique.mockResolvedValue(null);
      await expect(service.findItemById('item-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('adjustStock', () => {
    it('throws BadRequestException when adjustment would make availableQty negative', async () => {
      mockPrisma.item.findUnique.mockResolvedValue({ ...baseItem, availableQty: 3 });

      await expect(
        service.adjustStock('item-1', { quantity: -5, reason: 'test' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('adjusts totalQty and availableQty and creates movement', async () => {
      mockPrisma.item.findUnique.mockResolvedValue(baseItem);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      mockPrisma.item.update.mockResolvedValue({ ...baseItem, totalQty: 12, availableQty: 12 });
      mockPrisma.inventoryMovement.create.mockResolvedValue({});

      await service.adjustStock('item-1', { quantity: 2, reason: 'new purchase' }, 'user-1');

      expect(mockPrisma.item.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ totalQty: 12, availableQty: 12 }),
        }),
      );
      expect(mockPrisma.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: InventoryMovementType.manual_adjustment }),
        }),
      );
    });
  });

  describe('deactivateItem', () => {
    it('throws ConflictException when item has active rentals', async () => {
      mockPrisma.item.findUnique.mockResolvedValue({ ...baseItem, rentedQty: 2 });

      await expect(service.deactivateItem('item-1', 'user-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('soft deletes item and creates audit log', async () => {
      mockPrisma.item.findUnique.mockResolvedValue(baseItem);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      mockPrisma.item.update.mockResolvedValue({ ...baseItem, isActive: false });

      await service.deactivateItem('item-1', 'user-1');

      expect(mockPrisma.item.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }),
      );
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'deactivate_item' }),
        mockPrisma,
      );
    });
  });
});
