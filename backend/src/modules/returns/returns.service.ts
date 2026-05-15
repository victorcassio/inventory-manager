import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InventoryMovementType, RentalStatus, ReturnItemCondition } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { AuditService, Tx } from '../audit/audit.service';
import { CreateReturnDto } from './dto/create-return.dto';

function movementTypeFor(condition: ReturnItemCondition): InventoryMovementType {
  if (condition === ReturnItemCondition.good) return InventoryMovementType.rental_return;
  if (condition === ReturnItemCondition.damaged) return InventoryMovementType.maintenance_in;
  return InventoryMovementType.deactivation;
}

@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
    private readonly audit: AuditService,
  ) {}

  async registerReturn(rentalId: string, dto: CreateReturnDto, userId: string): Promise<any> {
    return this.prisma.$transaction(async (tx: Tx) => {
      // 1. Fetch rental with rentalItems
      const rental = (await tx.rental.findUnique({
        where: { id: rentalId },
        include: { rentalItems: true },
      })) as any;

      if (!rental) throw new NotFoundException('Rental not found');
      if (rental.status !== RentalStatus.active) {
        throw new BadRequestException(
          `Cannot register return for rental with status '${rental.status}'`,
        );
      }

      const returnedAt = dto.returnedAt ? new Date(dto.returnedAt) : new Date();

      // 2. Validate each item in the DTO
      const processedItems: Array<{
        rentalItemId: string;
        quantity: number;
        condition: ReturnItemCondition;
        damageFee?: number;
        notes?: string;
        rentalItem: any;
      }> = [];

      for (const ri of dto.items) {
        const rentalItem = rental.rentalItems.find((r: any) => r.id === ri.rentalItemId);
        if (!rentalItem) {
          throw new BadRequestException(
            `RentalItem ${ri.rentalItemId} does not belong to rental ${rentalId}`,
          );
        }

        const pendingQty = rentalItem.quantity - rentalItem.returnedQty;
        if (ri.quantity > pendingQty) {
          throw new BadRequestException(
            `Cannot return ${ri.quantity} of item ${ri.rentalItemId}: only ${pendingQty} pending`,
          );
        }

        if (ri.condition === ReturnItemCondition.good && ri.damageFee && ri.damageFee > 0) {
          throw new BadRequestException('damageFee must be 0 or absent for condition good');
        }
        if (
          (ri.condition === ReturnItemCondition.damaged ||
            ri.condition === ReturnItemCondition.lost) &&
          (!ri.damageFee || ri.damageFee <= 0)
        ) {
          throw new BadRequestException(
            `damageFee is required and must be > 0 for condition ${ri.condition}`,
          );
        }

        processedItems.push({ ...ri, rentalItem });
      }

      // 3. Calculate lateDays and lateFee for this return
      const expectedReturn = new Date(rental.expectedReturn);
      expectedReturn.setHours(0, 0, 0, 0);
      const returnDate = new Date(returnedAt);
      returnDate.setHours(0, 0, 0, 0);

      const lateDays = Math.max(
        0,
        Math.ceil((returnDate.getTime() - expectedReturn.getTime()) / (1000 * 60 * 60 * 24)),
      );

      const lateFeeThisReturn =
        lateDays > 0
          ? processedItems.reduce(
              (sum, ri) => sum + ri.quantity * Number(ri.rentalItem.unitPrice) * lateDays,
              0,
            )
          : 0;

      // 4. Create Return record (isPartial resolved after completeness check)
      const returnRecord = (await tx.return.create({
        data: {
          rentalId,
          userId,
          returnedAt,
          isPartial: true,
          lateDays,
          lateFee: lateFeeThisReturn,
          notes: dto.notes,
        },
      })) as any;

      // 5. Create ReturnItems, update RentalItem.returnedQty, update stock
      for (const ri of processedItems) {
        await tx.returnItem.create({
          data: {
            returnId: returnRecord.id,
            rentalItemId: ri.rentalItemId,
            quantity: ri.quantity,
            condition: ri.condition,
            damageFee: ri.damageFee ?? 0,
            notes: ri.notes,
          },
        });

        await tx.rentalItem.update({
          where: { id: ri.rentalItemId },
          data: { returnedQty: { increment: ri.quantity } },
        });

        await this.inventoryService.creditStock(
          ri.rentalItem.itemId,
          ri.quantity,
          movementTypeFor(ri.condition),
          rentalId,
          userId,
          tx,
        );
      }

      // 6. Check completeness: fetch updated rentalItems
      const allRentalItems = (await tx.rentalItem.findMany({ where: { rentalId } })) as any[];
      const allReturned = allRentalItems.every((ri) => ri.returnedQty >= ri.quantity);
      const isPartial = !allReturned;

      // 7. Finalise Return.isPartial
      const finalReturn = await tx.return.update({
        where: { id: returnRecord.id },
        data: { isPartial },
      });

      // 8. Update Rental (always accumulate lateFee; set status on full return)
      const rentalUpdateData: any = {
        lateFee: { increment: lateFeeThisReturn },
      };
      if (allReturned) {
        rentalUpdateData.status = RentalStatus.returned;
        rentalUpdateData.returnedAt = returnedAt;
      }
      await tx.rental.update({ where: { id: rentalId }, data: rentalUpdateData });

      // 9. Audit log
      const totalDamageFee = processedItems.reduce(
        (sum, ri) => sum + (ri.damageFee ?? 0),
        0,
      );
      await this.audit.log(
        {
          userId,
          action: 'register_return',
          entity: 'Return',
          entityId: returnRecord.id,
          payload: {
            rentalId,
            isPartial,
            lateDays,
            lateFee: lateFeeThisReturn,
            returnedItems: processedItems.length,
            totalDamageFee,
          } as any,
        },
        tx,
      );

      return { ...finalReturn, isPartial };
    });
  }

  async getReturnsByRental(rentalId: string): Promise<any[]> {
    const rental = await this.prisma.rental.findUnique({ where: { id: rentalId } });
    if (!rental) throw new NotFoundException('Rental not found');

    return this.prisma.return.findMany({
      where: { rentalId },
      include: { returnItems: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getReturnById(id: string): Promise<any> {
    const returnRecord = await this.prisma.return.findUnique({
      where: { id },
      include: {
        returnItems: {
          include: {
            rentalItem: {
              include: { item: { select: { id: true, name: true, code: true } } },
            },
          },
        },
        rental: {
          include: { customer: { select: { id: true, name: true, document: true } } },
        },
      },
    });

    if (!returnRecord) throw new NotFoundException('Return not found');
    return returnRecord;
  }
}
