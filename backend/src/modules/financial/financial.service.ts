import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FinancialTransactionCategory,
  FinancialTransactionOrigin,
  FinancialTransactionType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, Tx } from '../audit/audit.service';
import { CreateFinancialTransactionDto } from './dto/create-financial-transaction.dto';
import { UpdateFinancialTransactionDto } from './dto/update-financial-transaction.dto';
import { VoidFinancialTransactionDto } from './dto/void-financial-transaction.dto';
import { PaginatedResult } from '../../common/types/paginated-result.interface';

interface ListQuery {
  page?: number;
  limit?: number;
  type?: FinancialTransactionType;
  category?: FinancialTransactionCategory;
  origin?: FinancialTransactionOrigin;
  isVoided?: boolean;
  rentalId?: string;
  paymentId?: string;
  dateFrom?: string;
  dateTo?: string;
}

@Injectable()
export class FinancialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createManualTransaction(
    dto: CreateFinancialTransactionDto,
    userId: string,
  ): Promise<any> {
    if (dto.amount <= 0) {
      throw new BadRequestException('Amount must be greater than 0');
    }

    if (dto.rentalId) {
      const rental = await this.prisma.rental.findUnique({ where: { id: dto.rentalId } });
      if (!rental) throw new NotFoundException('Rental not found');
    }

    return this.prisma.$transaction(async (tx: Tx) => {
      const transaction = await tx.financialTransaction.create({
        data: {
          userId,
          rentalId: dto.rentalId,
          type: dto.type,
          category: dto.category,
          origin: FinancialTransactionOrigin.manual,
          amount: dto.amount,
          description: dto.description,
          date: new Date(dto.transactionDate),
        },
      });

      await this.audit.log(
        {
          userId,
          action: 'create_financial_transaction',
          entity: 'FinancialTransaction',
          entityId: transaction.id,
          payload: {
            type: dto.type,
            category: dto.category,
            amount: dto.amount,
            rentalId: dto.rentalId ?? null,
            origin: FinancialTransactionOrigin.manual,
          } as any,
        },
        tx,
      );

      return transaction;
    });
  }

  async listTransactions(query: ListQuery): Promise<PaginatedResult<any>> {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const skip = (page - 1) * limit;

    const where: any = {
      isVoided: query.isVoided !== undefined ? query.isVoided : false,
    };

    if (query.type) where.type = query.type;
    if (query.category) where.category = query.category;
    if (query.origin) where.origin = query.origin;
    if (query.rentalId) where.rentalId = query.rentalId;
    if (query.paymentId) where.paymentId = query.paymentId;

    const dateWhere: any = {};
    if (query.dateFrom) dateWhere.gte = new Date(query.dateFrom);
    if (query.dateTo) {
      const end = new Date(query.dateTo);
      end.setDate(end.getDate() + 1);
      dateWhere.lt = end;
    }
    if (Object.keys(dateWhere).length > 0) where.date = dateWhere;

    const [data, total] = await Promise.all([
      this.prisma.financialTransaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { date: 'desc' },
        include: {
          user: { select: { id: true, name: true, email: true } },
          rental: { select: { id: true, contractNumber: true } },
          payment: { select: { id: true, amount: true, method: true, paidAt: true } },
        },
      }),
      this.prisma.financialTransaction.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async getTransactionById(id: string): Promise<any> {
    const transaction = await this.prisma.financialTransaction.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true } },
        rental: { select: { id: true, contractNumber: true, status: true } },
        payment: {
          select: { id: true, amount: true, method: true, paidAt: true, referenceCode: true },
        },
      },
    });

    if (!transaction) throw new NotFoundException('Financial transaction not found');
    return transaction;
  }

  async updateManualTransaction(
    id: string,
    dto: UpdateFinancialTransactionDto,
    userId: string,
  ): Promise<any> {
    const transaction = await this.prisma.financialTransaction.findUnique({ where: { id } });
    if (!transaction) throw new NotFoundException('Financial transaction not found');

    if (transaction.origin !== FinancialTransactionOrigin.manual) {
      throw new BadRequestException('Only transactions with origin=manual can be edited');
    }
    if (transaction.isVoided) {
      throw new BadRequestException('Voided transactions cannot be edited');
    }

    return this.prisma.$transaction(async (tx: Tx) => {
      const updateData: any = {};
      if (dto.type !== undefined) updateData.type = dto.type;
      if (dto.category !== undefined) updateData.category = dto.category;
      if (dto.amount !== undefined) updateData.amount = dto.amount;
      if (dto.description !== undefined) updateData.description = dto.description;
      if (dto.transactionDate !== undefined) updateData.date = new Date(dto.transactionDate);
      if (dto.rentalId !== undefined) updateData.rentalId = dto.rentalId;
      // origin and paymentId are intentionally excluded

      const updated = await tx.financialTransaction.update({ where: { id }, data: updateData });

      await this.audit.log(
        {
          userId,
          action: 'update_financial_transaction',
          entity: 'FinancialTransaction',
          entityId: id,
          payload: { before: transaction, after: dto } as any,
        },
        tx,
      );

      return updated;
    });
  }

  async voidManualTransaction(
    id: string,
    dto: VoidFinancialTransactionDto,
    userId: string,
  ): Promise<void> {
    const transaction = await this.prisma.financialTransaction.findUnique({ where: { id } });
    if (!transaction) throw new NotFoundException('Financial transaction not found');

    if (transaction.origin !== FinancialTransactionOrigin.manual) {
      throw new BadRequestException('Only transactions with origin=manual can be voided');
    }
    if (transaction.isVoided) {
      throw new BadRequestException('Transaction is already voided');
    }

    await this.prisma.$transaction(async (tx: Tx) => {
      await tx.financialTransaction.update({
        where: { id },
        data: {
          isVoided: true,
          voidedAt: new Date(),
          voidedById: userId,
          voidReason: dto.reason,
        },
      });

      await this.audit.log(
        {
          userId,
          action: 'void_financial_transaction',
          entity: 'FinancialTransaction',
          entityId: id,
          payload: {
            transactionId: id,
            amount: Number(transaction.amount),
            reason: dto.reason,
          } as any,
        },
        tx,
      );
    });
  }
}
