import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PricingType, RentalStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { AuditService, Tx } from '../audit/audit.service';
import { CreateRentalDto } from './dto/create-rental.dto';
import { UpdateRentalDto } from './dto/update-rental.dto';
import { PaginatedResult } from '../../common/types/paginated-result.interface';

interface ListQuery {
  page?: number;
  limit?: number;
  status?: string;
  computedStatus?: string;
  customerId?: string;
  contractNumber?: string;
  startDate?: string;
  expectedReturnDate?: string;
}

function diffDays(end: Date, start: Date): number {
  return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

@Injectable()
export class RentalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
    private readonly audit: AuditService,
  ) {}

  // ─── Computed fields helpers ────────────────────────────────────────────

  enrichRental(rental: any) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expectedReturn = new Date(rental.expectedReturn);
    expectedReturn.setHours(0, 0, 0, 0);

    let computedStatus: string = rental.status;
    let daysOverdue = 0;

    if (rental.status === RentalStatus.active && expectedReturn < today) {
      daysOverdue = diffDays(today, expectedReturn);
      computedStatus = 'overdue';
    }

    return { ...rental, computedStatus, daysOverdue };
  }

  private computeBalance(rental: any): number {
    const totalDamageFees = (rental.returns ?? []).flatMap((r: any) => r.returnItems ?? [])
      .reduce((sum: number, ri: any) => sum + Number(ri.damageFee ?? 0), 0);
    return (
      Number(rental.total ?? 0) +
      Number(rental.lateFee ?? 0) +
      totalDamageFees -
      Number(rental.paidAmount ?? 0)
    );
  }

  // ─── createRental ────────────────────────────────────────────────────────

  async createRental(dto: CreateRentalDto, userId: string): Promise<any> {
    const startDate = new Date(dto.startDate);
    const expectedReturn = new Date(dto.expectedReturn);

    if (expectedReturn <= startDate) {
      throw new BadRequestException('expectedReturn must be after startDate');
    }

    const customer = await this.prisma.customer.findUnique({ where: { id: dto.customerId } });
    if (!customer || !customer.isActive) {
      throw new NotFoundException('Customer not found or inactive');
    }

    const days = diffDays(expectedReturn, startDate);

    return this.prisma.$transaction(async (tx: Tx) => {
      // Generate contract number atomically
      const year = new Date().getFullYear();
      await tx.contractCounter.upsert({
        where: { year },
        create: { year, lastSeq: 0 },
        update: {},
      });
      const counter = await tx.contractCounter.update({
        where: { year },
        data: { lastSeq: { increment: 1 } },
      });
      const contractNumber = `${year}-${String(counter.lastSeq).padStart(4, '0')}`;

      // Fetch all items in one query, validate, collect unitPrice
      const itemIds = dto.items.map(ri => ri.itemId);
      const fetchedItems = await tx.item.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, code: true, isActive: true, availableQty: true, dailyRate: true },
      });
      const itemMap = new Map(fetchedItems.map(i => [i.id, i]));

      const itemsData: Array<{ itemId: string; quantity: number; unitPrice: number }> = [];
      for (const ri of dto.items) {
        const item = itemMap.get(ri.itemId);
        if (!item || !item.isActive) {
          throw new NotFoundException(`Item ${ri.itemId} not found or inactive`);
        }
        if (item.availableQty < ri.quantity) {
          throw new BadRequestException(
            `Insufficient stock for item ${item.code}: available ${item.availableQty}, requested ${ri.quantity}`,
          );
        }
        itemsData.push({ itemId: ri.itemId, quantity: ri.quantity, unitPrice: Number(item.dailyRate) });
      }

      // Create rental
      const rental = await tx.rental.create({
        data: {
          customerId: dto.customerId,
          userId,
          contractNumber,
          status: RentalStatus.active,
          startedAt: startDate,
          expectedReturn,
          pricingType: dto.pricingType ?? PricingType.daily,
          deposit: dto.deposit ?? 0,
          discount: dto.discount ?? 0,
          extraCosts: dto.extraCosts ?? 0,
          notes: dto.notes,
        },
      });

      // Create rental items
      await tx.rentalItem.createMany({
        data: itemsData.map((ri) => ({
          rentalId: rental.id,
          itemId: ri.itemId,
          quantity: ri.quantity,
          unitPrice: ri.unitPrice,
        })),
      });

      // Calculate and persist subtotal/total
      const discount = dto.discount ?? 0;
      const extraCosts = dto.extraCosts ?? 0;
      const subtotal = itemsData.reduce((sum, ri) => sum + ri.quantity * ri.unitPrice * days, 0);
      const total = subtotal - discount + extraCosts;
      await tx.rental.update({ where: { id: rental.id }, data: { subtotal, total } });

      // Debit stock via InventoryService (creates InventoryMovement internally)
      for (const ri of itemsData) {
        await this.inventoryService.debitStock(ri.itemId, ri.quantity, rental.id, userId, tx);
      }

      // Audit log
      await this.audit.log(
        {
          userId,
          action: 'create_rental',
          entity: 'Rental',
          entityId: rental.id,
          payload: { contractNumber, itemCount: dto.items.length } as any,
        },
        tx,
      );

      return this.enrichRental({ ...rental, subtotal, total });
    });
  }

  // ─── findAll ─────────────────────────────────────────────────────────────

  async findAll(query: ListQuery): Promise<PaginatedResult<any>> {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const skip = (page - 1) * limit;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const where: any = {};

    if (query.customerId) where.customerId = query.customerId;
    if (query.contractNumber) where.contractNumber = { contains: query.contractNumber };
    if (query.startDate) where.startedAt = { gte: new Date(query.startDate) };
    if (query.expectedReturnDate) where.expectedReturn = { lte: new Date(query.expectedReturnDate) };

    if (query.computedStatus === 'overdue') {
      where.status = RentalStatus.active;
      where.expectedReturn = { lt: today };
    } else if (query.computedStatus === 'active') {
      where.status = RentalStatus.active;
      where.expectedReturn = { gte: today };
    } else if (query.computedStatus) {
      where.status = query.computedStatus as RentalStatus;
    } else if (query.status) {
      where.status = query.status as RentalStatus;
    }

    const [rentals, total] = await Promise.all([
      this.prisma.rental.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true, document: true } },
          rentalItems: { select: { id: true, itemId: true, quantity: true, unitPrice: true } },
        },
      }),
      this.prisma.rental.count({ where }),
    ]);

    return {
      data: rentals.map((r) => this.enrichRental(r)),
      total,
      page,
      limit,
    };
  }

  // ─── findRentalById ──────────────────────────────────────────────────────

  async findRentalById(id: string): Promise<any> {
    const rental = await this.prisma.rental.findUnique({
      where: { id },
      include: {
        customer: true,
        rentalItems: {
          include: { item: { select: { id: true, name: true, code: true, dailyRate: true } } },
        },
        payments: { orderBy: { createdAt: 'desc' } },
        returns: {
          include: { returnItems: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!rental) throw new NotFoundException('Rental not found');

    const balanceAmount = this.computeBalance(rental);
    return { ...this.enrichRental(rental), balanceAmount };
  }

  // ─── updateRental ────────────────────────────────────────────────────────

  async updateRental(id: string, dto: UpdateRentalDto, userId: string): Promise<any> {
    const rental = await this.prisma.rental.findUnique({
      where: { id },
      include: { rentalItems: true },
    });
    if (!rental) throw new NotFoundException('Rental not found');

    return this.prisma.$transaction(async (tx: Tx) => {
      const updateData: any = {};

      if (dto.notes !== undefined) updateData.notes = dto.notes;
      if (dto.deposit !== undefined) updateData.deposit = dto.deposit;
      if (dto.discount !== undefined) updateData.discount = dto.discount;
      if (dto.extraCosts !== undefined) updateData.extraCosts = dto.extraCosts;

      let expectedReturn = new Date(rental.expectedReturn);
      if (dto.expectedReturn) {
        expectedReturn = new Date(dto.expectedReturn);
        updateData.expectedReturn = expectedReturn;
      }

      // Recalculate subtotal/total if financial fields changed
      if (dto.expectedReturn || dto.discount !== undefined || dto.extraCosts !== undefined) {
        const startedAt = new Date(rental.startedAt);
        const days = Math.max(1, diffDays(expectedReturn, startedAt));
        const subtotal = (rental as any).rentalItems.reduce(
          (sum: number, ri: any) => sum + ri.quantity * Number(ri.unitPrice) * days,
          0,
        );
        const discount = dto.discount ?? Number(rental.discount);
        const extraCosts = dto.extraCosts ?? Number(rental.extraCosts);
        updateData.subtotal = subtotal;
        updateData.total = subtotal - discount + extraCosts;
      }

      const updated = await tx.rental.update({ where: { id }, data: updateData });

      await this.audit.log(
        { userId, action: 'update_rental', entity: 'Rental', entityId: id },
        tx,
      );

      return this.enrichRental(updated);
    });
  }

  // ─── cancelRental ────────────────────────────────────────────────────────

  async cancelRental(id: string, userId: string): Promise<void> {
    const rental = await this.prisma.rental.findUnique({
      where: { id },
      include: {
        rentalItems: true,
        payments: { take: 1 },
        returns: { take: 1 },
      },
    }) as any;

    if (!rental) throw new NotFoundException('Rental not found');
    if (rental.status !== RentalStatus.active) {
      throw new BadRequestException(
        `Cannot cancel rental with status '${rental.status}'. Only active rentals can be canceled.`,
      );
    }
    if (rental.payments.length > 0) {
      throw new BadRequestException('Cannot cancel rental with registered payments');
    }
    if (rental.returns.length > 0) {
      throw new BadRequestException('Cannot cancel rental with registered returns');
    }

    await this.prisma.$transaction(async (tx: Tx) => {
      for (const ri of rental.rentalItems) {
        await this.inventoryService.revertRentalStock(ri.itemId, ri.quantity, id, userId, tx);
      }

      await tx.rental.update({
        where: { id },
        data: { status: RentalStatus.canceled },
      });

      await this.audit.log(
        { userId, action: 'cancel_rental', entity: 'Rental', entityId: id },
        tx,
      );
    });
  }
}
