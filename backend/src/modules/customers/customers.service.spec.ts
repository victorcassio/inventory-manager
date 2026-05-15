import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CustomerDocumentType } from '@prisma/client';
import { CustomersService } from './customers.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const baseCustomer = {
  id: 'cust-1',
  name: 'Acme Corp',
  document: '12345678000195',
  documentType: CustomerDocumentType.cnpj,
  phone: null,
  email: null,
  address: null,
  notes: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockPrisma = {
  customer: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockAudit = { log: jest.fn() };

describe('CustomersService', () => {
  let service: CustomersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();
    service = module.get<CustomersService>(CustomersService);
  });

  describe('create', () => {
    const dto = {
      name: 'Acme Corp',
      document: '12.345.678/0001-95',
      documentType: CustomerDocumentType.cnpj,
    };

    it('normalizes document to digits only before saving', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (cb: any) =>
        cb(mockPrisma),
      );
      mockPrisma.customer.create.mockResolvedValue(baseCustomer);

      await service.create(dto, 'user-1');

      expect(mockPrisma.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ document: '12345678000195' }),
        }),
      );
    });

    it('throws ConflictException when document already exists', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(baseCustomer);

      await expect(service.create(dto, 'user-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('creates audit log after successful creation', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (cb: any) =>
        cb(mockPrisma),
      );
      mockPrisma.customer.create.mockResolvedValue(baseCustomer);

      await service.create(dto, 'user-1');

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'create_customer', entity: 'Customer' }),
        mockPrisma,
      );
    });
  });

  describe('findAll', () => {
    it('returns paginated list with total count', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([baseCustomer]);
      mockPrisma.customer.count.mockResolvedValue(1);

      const result = await service.findAll({});

      expect(result).toEqual({ data: [baseCustomer], total: 1, page: 1, limit: 20 });
    });

    it('filters by isActive: true by default', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.customer.count.mockResolvedValue(0);

      await service.findAll({});

      expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true }),
        }),
      );
    });
  });

  describe('findById', () => {
    it('returns customer when found', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(baseCustomer);
      const result = await service.findById('cust-1');
      expect(result).toEqual(baseCustomer);
    });

    it('throws NotFoundException when customer does not exist', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);
      await expect(service.findById('cust-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('updates customer and creates audit log', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(baseCustomer);
      mockPrisma.$transaction.mockImplementation(async (cb: any) =>
        cb(mockPrisma),
      );
      mockPrisma.customer.update.mockResolvedValue({
        ...baseCustomer,
        name: 'Updated',
      });

      const result = await service.update('cust-1', { name: 'Updated' }, 'user-1');

      expect(result.name).toBe('Updated');
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'update_customer' }),
        mockPrisma,
      );
    });

    it('throws NotFoundException when customer does not exist', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);
      await expect(
        service.update('cust-1', { name: 'X' }, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deactivate', () => {
    it('sets isActive to false and creates audit log', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(baseCustomer);
      mockPrisma.$transaction.mockImplementation(async (cb: any) =>
        cb(mockPrisma),
      );
      mockPrisma.customer.update.mockResolvedValue({
        ...baseCustomer,
        isActive: false,
      });

      await service.deactivate('cust-1', 'user-1');

      expect(mockPrisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isActive: false }),
        }),
      );
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'deactivate_customer' }),
        mockPrisma,
      );
    });

    it('throws NotFoundException when customer does not exist', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);
      await expect(service.deactivate('cust-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
