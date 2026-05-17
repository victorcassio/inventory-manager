import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FinancialTransactionCategory,
  FinancialTransactionOrigin,
  FinancialTransactionType,
  PaymentMethod,
  RentalStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, Tx } from '../audit/audit.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaginatedResult } from '../../common/types/paginated-result.interface';

interface ListQuery {
  page?: number;
  limit?: number;
  rentalId?: string;
  customerId?: string;
  method?: PaymentMethod;
  dateFrom?: string;
  dateTo?: string;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async registerPayment(rentalId: string, dto: CreatePaymentDto, userId: string): Promise<any> {
    return this.prisma.$transaction(async (tx: Tx) => {
      // 1. Fetch rental with returns for balance calculation
      const rental = (await tx.rental.findUnique({
        where: { id: rentalId },
        include: {
          returns: {
            include: { returnItems: { select: { damageFee: true } } },
          },
        },
      })) as any;

      if (!rental) throw new NotFoundException('Rental not found');
      if (rental.status === RentalStatus.canceled) {
        throw new BadRequestException('Cannot register payment for a canceled rental');
      }

      // 2. Calculate balance
      const totalDamageFees = (rental.returns ?? [])
        .flatMap((r: any) => r.returnItems ?? [])
        .reduce((sum: number, ri: any) => sum + Number(ri.damageFee ?? 0), 0);

      const balanceAmount =
        Number(rental.total ?? 0) +
        Number(rental.lateFee ?? 0) +
        totalDamageFees -
        Number(rental.paidAmount ?? 0);

      // 3. Validate amount
      if (dto.amount <= 0) {
        throw new BadRequestException('Payment amount must be greater than 0');
      }
      if (dto.amount > balanceAmount) {
        throw new BadRequestException(
          `Payment amount (${dto.amount}) exceeds outstanding balance (${balanceAmount.toFixed(2)})`,
        );
      }

      const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();

      // 4. Create Payment
      const payment = (await tx.payment.create({
        data: {
          rentalId,
          userId,
          amount: dto.amount,
          method: dto.method,
          paidAt,
          referenceCode: dto.referenceCode,
          notes: dto.notes,
        },
      })) as any;

      // 5. Update Rental.paidAmount
      await tx.rental.update({
        where: { id: rentalId },
        data: { paidAmount: { increment: dto.amount } },
      });

      // 6. Create FinancialTransaction automatically
      const financialTransaction = (await tx.financialTransaction.create({
        data: {
          userId,
          rentalId,
          paymentId: payment.id,
          type: FinancialTransactionType.income,
          category: FinancialTransactionCategory.rental_income,
          origin: FinancialTransactionOrigin.payment,
          amount: dto.amount,
          description: `Rental payment — ${rental.contractNumber}`,
          date: paidAt,
        },
      })) as any;

      // 7. Audit log
      await this.audit.log(
        {
          userId,
          action: 'register_payment',
          entity: 'Payment',
          entityId: payment.id,
          payload: {
            rentalId,
            amount: dto.amount,
            method: dto.method,
            balanceBefore: balanceAmount,
            balanceAfter: balanceAmount - dto.amount,
            financialTransactionId: financialTransaction.id,
          } as any,
        },
        tx,
      );

      return payment;
    });
  }

  async getPaymentsByRental(rentalId: string): Promise<any[]> {
    const rental = await this.prisma.rental.findUnique({ where: { id: rentalId } });
    if (!rental) throw new NotFoundException('Rental not found');

    return this.prisma.payment.findMany({
      where: { rentalId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { paidAt: 'desc' },
    });
  }

  async getPaymentById(id: string): Promise<any> {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        rental: {
          include: { customer: { select: { id: true, name: true, document: true } } },
        },
        user: { select: { id: true, name: true, email: true } },
        financialTransactions: { take: 1 },
      },
    });

    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  async listPayments(query: ListQuery): Promise<PaginatedResult<any>> {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (query.rentalId) where.rentalId = query.rentalId;
    if (query.method) where.method = query.method;
    if (query.customerId) where.rental = { customerId: query.customerId };

    const dateWhere: any = {};
    if (query.dateFrom) dateWhere.gte = new Date(query.dateFrom);
    if (query.dateTo) dateWhere.lte = new Date(query.dateTo);
    if (Object.keys(dateWhere).length > 0) where.paidAt = dateWhere;

    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { paidAt: 'desc' },
        include: {
          rental: { select: { id: true, contractNumber: true } },
          user: { select: { id: true, name: true } },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return { data, total, page, limit };
  }
}
