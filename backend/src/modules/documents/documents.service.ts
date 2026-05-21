import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { DocumentStatus, DocumentType, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PaginatedResult } from '../../common/types/paginated-result.interface';
import { buildContractPdf } from './templates/contract.template';
import { buildReceiptPdf } from './templates/receipt.template';
import { buildReturnProofPdf } from './templates/return-proof.template';

interface DownloadResult {
  path: string;
  filename: string;
  mimeType: string;
}

// Fields safe to expose publicly — path (filesystem) is intentionally excluded
const DOCUMENT_PUBLIC_SELECT = {
  id: true,
  type: true,
  status: true,
  filename: true,
  rentalId: true,
  customerId: true,
  paymentId: true,
  returnId: true,
  userId: true,
  createdAt: true,
} as const;

interface ListDocumentsQuery {
  page?: number;
  limit?: number;
  type?: DocumentType;
  status?: DocumentStatus;
  rentalId?: string;
  dateFrom?: string;
  dateTo?: string;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ─── Contract ─────────────────────────────────────────────────────────────

  async generateContract(rentalId: string, userId: string): Promise<any> {
    const rental = await this.prisma.rental.findUnique({
      where: { id: rentalId },
      include: {
        customer: true,
        rentalItems: { include: { item: true } },
      },
    });
    if (!rental) throw new NotFoundException('Rental not found');

    const buffer = await buildContractPdf(rental);
    const { filePath, filename } = await this.savePdf(rental.id, 'contract', buffer);

    const document = await this.prisma.document.create({
      data: {
        type: DocumentType.contract,
        status: DocumentStatus.generated,
        filename,
        path: filePath,
        rentalId: rental.id,
        customerId: rental.customerId,
        userId,
      },
      select: DOCUMENT_PUBLIC_SELECT,
    });

    await this.audit.log({
      userId,
      action: 'generate_document',
      entity: 'Document',
      entityId: document.id,
      payload: { type: 'contract', rentalId: rental.id, customerId: rental.customerId, filename } as any,
    });

    return document;
  }

  // ─── Receipt ──────────────────────────────────────────────────────────────

  async generateReceipt(paymentId: string, userId: string): Promise<any> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        rental: { include: { customer: true } },
        user: { select: { id: true, name: true } },
      },
    }) as any;
    if (!payment) throw new NotFoundException('Payment not found');

    const buffer = await buildReceiptPdf(payment);
    const { filePath, filename } = await this.savePdf(payment.rentalId, 'receipt', buffer);

    const document = await this.prisma.document.create({
      data: {
        type: DocumentType.receipt,
        status: DocumentStatus.generated,
        filename,
        path: filePath,
        rentalId: payment.rentalId,
        customerId: payment.rental?.customerId ?? null,
        paymentId,
        userId,
      },
      select: DOCUMENT_PUBLIC_SELECT,
    });

    await this.audit.log({
      userId,
      action: 'generate_document',
      entity: 'Document',
      entityId: document.id,
      payload: { type: 'receipt', rentalId: payment.rentalId, customerId: payment.rental?.customerId, paymentId, filename } as any,
    });

    return document;
  }

  // ─── Return Proof ─────────────────────────────────────────────────────────

  async generateReturnProof(returnId: string, userId: string): Promise<any> {
    const returnRecord = await this.prisma.return.findUnique({
      where: { id: returnId },
      include: {
        rental: { include: { customer: true } },
        returnItems: {
          include: {
            rentalItem: { include: { item: true } },
          },
        },
      },
    }) as any;
    if (!returnRecord) throw new NotFoundException('Return not found');

    const buffer = await buildReturnProofPdf(returnRecord);
    const { filePath, filename } = await this.savePdf(returnRecord.rentalId, 'return_proof', buffer);

    const document = await this.prisma.document.create({
      data: {
        type: DocumentType.return_proof,
        status: DocumentStatus.generated,
        filename,
        path: filePath,
        rentalId: returnRecord.rentalId,
        customerId: returnRecord.rental?.customerId ?? null,
        returnId,
        userId,
      },
      select: DOCUMENT_PUBLIC_SELECT,
    });

    await this.audit.log({
      userId,
      action: 'generate_document',
      entity: 'Document',
      entityId: document.id,
      payload: { type: 'return_proof', rentalId: returnRecord.rentalId, customerId: returnRecord.rental?.customerId, returnId, filename } as any,
    });

    return document;
  }

  // ─── List & Download ──────────────────────────────────────────────────────

  async listDocumentsByRental(rentalId: string): Promise<any[]> {
    return this.prisma.document.findMany({
      where: { rentalId },
      select: DOCUMENT_PUBLIC_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async downloadDocument(documentId: string, userRole: UserRole): Promise<DownloadResult> {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, path: true, filename: true, status: true, type: true },
    });
    if (!document) throw new NotFoundException('Document not found');

    if (document.status === DocumentStatus.voided) {
      throw new ForbiddenException('Este documento foi anulado e não pode ser baixado');
    }

    const allowedTypes: Record<UserRole, DocumentType[]> = {
      [UserRole.admin]: [DocumentType.contract, DocumentType.receipt, DocumentType.return_proof],
      [UserRole.attendant]: [DocumentType.contract, DocumentType.return_proof],
      [UserRole.financial]: [DocumentType.receipt],
    };

    if (!allowedTypes[userRole]?.includes(document.type)) {
      throw new ForbiddenException('Você não tem permissão para baixar este tipo de documento');
    }

    try {
      await fs.access(document.path);
    } catch {
      throw new NotFoundException('Document file not found on disk');
    }

    return { path: document.path, filename: document.filename, mimeType: 'application/pdf' };
  }

  // ─── listDocuments ────────────────────────────────────────────────────────

  async listDocuments(query: ListDocumentsQuery): Promise<PaginatedResult<any>> {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.type) where.type = query.type;
    if (query.status) where.status = query.status;
    if (query.rentalId) where.rentalId = query.rentalId;

    const dateWhere: any = {};
    if (query.dateFrom) dateWhere.gte = new Date(query.dateFrom);
    if (query.dateTo) {
      const end = new Date(query.dateTo);
      end.setDate(end.getDate() + 1);
      dateWhere.lt = end;
    }
    if (Object.keys(dateWhere).length > 0) where.createdAt = dateWhere;

    const [data, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          ...DOCUMENT_PUBLIC_SELECT,
          rental: {
            select: {
              id: true,
              contractNumber: true,
              customer: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.prisma.document.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async savePdf(
    rentalId: string,
    type: string,
    buffer: Buffer,
  ): Promise<{ filePath: string; filename: string }> {
    const dir = path.join(process.cwd(), 'storage', 'documents', rentalId);
    await fs.mkdir(dir, { recursive: true });
    const filename = `${type}-${Date.now()}.pdf`;
    const filePath = path.join(dir, filename);
    await fs.writeFile(filePath, buffer);
    return { filePath, filename };
  }
}
