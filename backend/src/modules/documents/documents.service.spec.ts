// jest.mock calls are hoisted before imports — factories run first
jest.mock('./templates/contract.template', () => ({
  buildContractPdf: jest.fn(),
}));
jest.mock('./templates/receipt.template', () => ({
  buildReceiptPdf: jest.fn(),
}));
jest.mock('./templates/return-proof.template', () => ({
  buildReturnProofPdf: jest.fn(),
}));
jest.mock('fs/promises', () => ({
  mkdir: jest.fn(),
  writeFile: jest.fn(),
  access: jest.fn(),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DocumentStatus, DocumentType, RentalStatus } from '@prisma/client';
import { DocumentsService } from './documents.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { buildContractPdf } from './templates/contract.template';
import { buildReceiptPdf } from './templates/receipt.template';
import { buildReturnProofPdf } from './templates/return-proof.template';
import * as fsMock from 'fs/promises';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const baseRental = {
  id: 'rental-1',
  contractNumber: '2026-0001',
  status: RentalStatus.active,
  customerId: 'cust-1',
  startedAt: new Date('2026-05-01'),
  expectedReturn: new Date('2026-05-08'),
  discount: 0,
  extraCosts: 0,
  deposit: 0,
  subtotal: 300,
  total: 300,
  paidAmount: 0,
  lateFee: 0,
  notes: null,
};

const baseCustomer = { id: 'cust-1', name: 'Acme Corp', document: '12345678000195' };

const basePayment = {
  id: 'payment-1',
  rentalId: 'rental-1',
  amount: 150,
  method: 'pix',
  paidAt: new Date(),
  referenceCode: null,
  notes: null,
  rental: { ...baseRental, customer: baseCustomer },
  user: { id: 'user-1', name: 'Admin' },
};

const baseReturnRecord = {
  id: 'return-1',
  rentalId: 'rental-1',
  isPartial: false,
  lateDays: 0,
  lateFee: 0,
  returnedAt: new Date(),
  notes: null,
  rental: { ...baseRental, customer: baseCustomer },
  returnItems: [
    {
      id: 'ri-1',
      quantity: 1,
      condition: 'good',
      damageFee: 0,
      notes: null,
      rentalItem: { item: { id: 'item-1', name: 'Andaime 1m', code: 'AND-001' } },
    },
  ],
};

const baseDocument = {
  id: 'doc-1',
  type: DocumentType.contract,
  status: DocumentStatus.generated,
  filename: 'contract-1234567890.pdf',
  path: '/fake/path/contract-1234567890.pdf',
  rentalId: 'rental-1',
  customerId: 'cust-1',
  paymentId: null,
  returnId: null,
  userId: 'user-1',
  createdAt: new Date(),
};

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  rental: { findUnique: jest.fn() },
  payment: { findUnique: jest.fn() },
  return: { findUnique: jest.fn() },
  document: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
};

const mockAudit = { log: jest.fn() };
const fakePdfBuffer = Buffer.from('fake-pdf-content');

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DocumentsService', () => {
  let service: DocumentsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    (buildContractPdf as jest.Mock).mockResolvedValue(fakePdfBuffer);
    (buildReceiptPdf as jest.Mock).mockResolvedValue(fakePdfBuffer);
    (buildReturnProofPdf as jest.Mock).mockResolvedValue(fakePdfBuffer);
    (fsMock.mkdir as jest.Mock).mockResolvedValue(undefined);
    (fsMock.writeFile as jest.Mock).mockResolvedValue(undefined);
    (fsMock.access as jest.Mock).mockResolvedValue(undefined);

    mockPrisma.document.create.mockResolvedValue(baseDocument);
    mockAudit.log.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get<DocumentsService>(DocumentsService);
  });

  // ─── generateContract ─────────────────────────────────────────────────────

  describe('generateContract', () => {
    beforeEach(() => {
      mockPrisma.rental.findUnique.mockResolvedValue({
        ...baseRental,
        customer: baseCustomer,
        rentalItems: [{ id: 'ri-1', quantity: 2, unitPrice: 15, item: { name: 'Andaime', code: 'AND-001' } }],
      });
    });

    it('generates contract PDF successfully', async () => {
      const result = await service.generateContract('rental-1', 'user-1');
      expect(result).toBeDefined();
      expect(fsMock.writeFile).toHaveBeenCalled();
    });

    it('fetches rental with customer and rentalItems including item', async () => {
      await service.generateContract('rental-1', 'user-1');
      expect(mockPrisma.rental.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rental-1' },
          include: expect.objectContaining({
            customer: true,
            rentalItems: expect.objectContaining({ include: expect.objectContaining({ item: true }) }),
          }),
        }),
      );
    });

    it('creates Document record with type contract', async () => {
      await service.generateContract('rental-1', 'user-1');
      expect(mockPrisma.document.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: DocumentType.contract }),
        }),
      );
    });

    it('creates AuditLog with action generate_document', async () => {
      await service.generateContract('rental-1', 'user-1');
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'generate_document', entity: 'Document' }),
      );
    });

    it('throws NotFoundException when rental does not exist', async () => {
      mockPrisma.rental.findUnique.mockResolvedValue(null);
      await expect(service.generateContract('rental-1', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── generateReceipt ──────────────────────────────────────────────────────

  describe('generateReceipt', () => {
    beforeEach(() => {
      mockPrisma.payment.findUnique.mockResolvedValue(basePayment);
    });

    it('generates receipt PDF successfully', async () => {
      const result = await service.generateReceipt('payment-1', 'user-1');
      expect(result).toBeDefined();
      expect(fsMock.writeFile).toHaveBeenCalled();
    });

    it('fetches payment with rental and customer', async () => {
      await service.generateReceipt('payment-1', 'user-1');
      expect(mockPrisma.payment.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'payment-1' },
          include: expect.objectContaining({
            rental: expect.objectContaining({ include: { customer: true } }),
          }),
        }),
      );
    });

    it('creates Document record with type receipt', async () => {
      await service.generateReceipt('payment-1', 'user-1');
      expect(mockPrisma.document.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: DocumentType.receipt }),
        }),
      );
    });

    it('stores paymentId on the Document record', async () => {
      await service.generateReceipt('payment-1', 'user-1');
      expect(mockPrisma.document.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ paymentId: 'payment-1' }),
        }),
      );
    });

    it('creates AuditLog with action generate_document', async () => {
      await service.generateReceipt('payment-1', 'user-1');
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'generate_document' }),
      );
    });

    it('throws NotFoundException when payment does not exist', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue(null);
      await expect(service.generateReceipt('payment-1', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── generateReturnProof ──────────────────────────────────────────────────

  describe('generateReturnProof', () => {
    beforeEach(() => {
      mockPrisma.return.findUnique.mockResolvedValue(baseReturnRecord);
    });

    it('generates return proof PDF successfully', async () => {
      const result = await service.generateReturnProof('return-1', 'user-1');
      expect(result).toBeDefined();
      expect(fsMock.writeFile).toHaveBeenCalled();
    });

    it('fetches return with rental, customer and returnItems', async () => {
      await service.generateReturnProof('return-1', 'user-1');
      expect(mockPrisma.return.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'return-1' },
          include: expect.objectContaining({
            rental: expect.any(Object),
            returnItems: expect.any(Object),
          }),
        }),
      );
    });

    it('creates Document record with type return_proof', async () => {
      await service.generateReturnProof('return-1', 'user-1');
      expect(mockPrisma.document.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: DocumentType.return_proof }),
        }),
      );
    });

    it('stores returnId on the Document record', async () => {
      await service.generateReturnProof('return-1', 'user-1');
      expect(mockPrisma.document.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ returnId: 'return-1' }),
        }),
      );
    });

    it('creates AuditLog with action generate_document', async () => {
      await service.generateReturnProof('return-1', 'user-1');
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'generate_document' }),
      );
    });

    it('throws NotFoundException when return does not exist', async () => {
      mockPrisma.return.findUnique.mockResolvedValue(null);
      await expect(service.generateReturnProof('return-1', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── listDocumentsByRental ────────────────────────────────────────────────

  describe('listDocumentsByRental', () => {
    it('returns documents for a rental', async () => {
      mockPrisma.document.findMany.mockResolvedValue([baseDocument]);
      const result = await service.listDocumentsByRental('rental-1');
      expect(result).toHaveLength(1);
      expect(mockPrisma.document.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { rentalId: 'rental-1' } }),
      );
    });
  });

  // ─── downloadDocument ─────────────────────────────────────────────────────

  describe('downloadDocument', () => {
    it('returns path, filename and mimeType for existing document', async () => {
      mockPrisma.document.findUnique.mockResolvedValue(baseDocument);
      (fsMock.access as jest.Mock).mockResolvedValue(undefined);

      const result = await service.downloadDocument('doc-1');
      expect(result).toMatchObject({
        path: baseDocument.path,
        filename: baseDocument.filename,
        mimeType: 'application/pdf',
      });
    });

    it('throws NotFoundException when document record does not exist', async () => {
      mockPrisma.document.findUnique.mockResolvedValue(null);
      await expect(service.downloadDocument('doc-1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when physical file does not exist on disk', async () => {
      mockPrisma.document.findUnique.mockResolvedValue(baseDocument);
      (fsMock.access as jest.Mock).mockRejectedValue(new Error('ENOENT'));
      await expect(service.downloadDocument('doc-1')).rejects.toThrow(NotFoundException);
    });
  });
});
