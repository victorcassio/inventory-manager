import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Item, ItemCategory, InventoryMovementType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, Tx } from '../audit/audit.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { PaginatedResult } from '../../common/types/paginated-result.interface';

interface ItemListQuery {
  page?: number;
  limit?: number;
  categoryId?: string;
  condition?: string;
  availableOnly?: boolean;
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ─── Categories ─────────────────────────────────────────────────────────

  async createCategory(dto: CreateCategoryDto, userId: string): Promise<ItemCategory> {
    return this.prisma.$transaction(async (tx: Tx) => {
      const category = await tx.itemCategory.create({
        data: { name: dto.name, description: dto.description },
      });
      await this.audit.log(
        { userId, action: 'create_category', entity: 'ItemCategory', entityId: category.id },
        tx,
      );
      return category;
    });
  }

  async findAllCategories(): Promise<ItemCategory[]> {
    return this.prisma.itemCategory.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async findCategoryById(id: string): Promise<ItemCategory> {
    const category = await this.prisma.itemCategory.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async updateCategory(id: string, dto: UpdateCategoryDto, userId: string): Promise<ItemCategory> {
    await this.findCategoryById(id);
    return this.prisma.$transaction(async (tx: Tx) => {
      const category = await tx.itemCategory.update({ where: { id }, data: dto });
      await this.audit.log(
        { userId, action: 'update_category', entity: 'ItemCategory', entityId: id },
        tx,
      );
      return category;
    });
  }

  async deactivateCategory(id: string, userId: string): Promise<void> {
    await this.findCategoryById(id);

    const activeItem = await this.prisma.item.findFirst({
      where: { categoryId: id, isActive: true },
    });
    if (activeItem) {
      throw new ConflictException('Category has active items and cannot be deactivated');
    }

    await this.prisma.$transaction(async (tx: Tx) => {
      await tx.itemCategory.update({ where: { id }, data: { isActive: false } });
      await this.audit.log(
        { userId, action: 'deactivate_category', entity: 'ItemCategory', entityId: id },
        tx,
      );
    });
  }

  // ─── Items ───────────────────────────────────────────────────────────────

  async createItem(dto: CreateItemDto, userId: string): Promise<Item> {
    const existingCode = await this.prisma.item.findUnique({ where: { code: dto.code } });
    if (existingCode) throw new ConflictException('An item with this code already exists');

    const category = await this.prisma.itemCategory.findUnique({ where: { id: dto.categoryId } });
    if (!category || !category.isActive) throw new NotFoundException('Category not found');

    return this.prisma.$transaction(async (tx: Tx) => {
      const item = await tx.item.create({
        data: {
          categoryId: dto.categoryId,
          name: dto.name,
          description: dto.description,
          code: dto.code,
          dailyRate: dto.dailyRate,
          totalQty: dto.totalQty,
          availableQty: dto.totalQty,
          rentedQty: 0,
          maintenanceQty: 0,
          condition: dto.condition,
          notes: dto.notes,
        },
      });

      await tx.inventoryMovement.create({
        data: {
          itemId: item.id,
          userId,
          type: InventoryMovementType.initial_stock,
          quantity: dto.totalQty,
          reason: 'Initial stock entry',
        },
      });

      await this.audit.log(
        { userId, action: 'create_item', entity: 'Item', entityId: item.id },
        tx,
      );

      return item;
    });
  }

  async findAllItems(query: ItemListQuery): Promise<PaginatedResult<Item>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: any = { isActive: true };
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.condition) where.condition = query.condition;
    if (query.availableOnly) where.availableQty = { gt: 0 };

    const [data, total] = await Promise.all([
      this.prisma.item.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        include: { category: { select: { id: true, name: true } } },
      }),
      this.prisma.item.count({ where }),
    ]);

    return { data: data as unknown as Item[], total, page, limit };
  }

  async findItemById(id: string): Promise<Item> {
    const item = await this.prisma.item.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, name: true } },
        inventoryMovements: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });
    if (!item) throw new NotFoundException('Item not found');
    return item as unknown as Item;
  }

  async updateItem(id: string, dto: UpdateItemDto, userId: string): Promise<Item> {
    await this.findItemById(id);

    if (dto.categoryId) {
      const category = await this.prisma.itemCategory.findUnique({ where: { id: dto.categoryId } });
      if (!category || !category.isActive) throw new NotFoundException('Category not found');
    }

    return this.prisma.$transaction(async (tx: Tx) => {
      const item = await tx.item.update({ where: { id }, data: dto });
      await this.audit.log(
        { userId, action: 'update_item', entity: 'Item', entityId: id },
        tx,
      );
      return item;
    });
  }

  async adjustStock(id: string, dto: AdjustStockDto, userId: string): Promise<Item> {
    const item = await this.prisma.item.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Item not found');

    const newAvailableQty = item.availableQty + dto.quantity;
    const newTotalQty = item.totalQty + dto.quantity;

    if (newAvailableQty < 0) {
      throw new BadRequestException('Adjustment would result in negative available quantity');
    }
    if (newTotalQty < item.rentedQty + item.maintenanceQty) {
      throw new BadRequestException('Adjustment would make totalQty less than rentedQty + maintenanceQty');
    }

    return this.prisma.$transaction(async (tx: Tx) => {
      const updated = await tx.item.update({
        where: { id },
        data: { totalQty: newTotalQty, availableQty: newAvailableQty },
      });

      await tx.inventoryMovement.create({
        data: {
          itemId: id,
          userId,
          type: InventoryMovementType.manual_adjustment,
          quantity: dto.quantity,
          reason: dto.reason,
        },
      });

      await this.audit.log(
        {
          userId,
          action: 'adjust_stock',
          entity: 'Item',
          entityId: id,
          payload: { quantity: dto.quantity, reason: dto.reason },
        },
        tx,
      );

      return updated;
    });
  }

  async deactivateItem(id: string, userId: string): Promise<void> {
    const item = await this.prisma.item.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Item not found');

    if (item.rentedQty > 0) {
      throw new ConflictException('Item has active rentals and cannot be deactivated');
    }

    await this.prisma.$transaction(async (tx: Tx) => {
      await tx.item.update({ where: { id }, data: { isActive: false } });
      await this.audit.log(
        { userId, action: 'deactivate_item', entity: 'Item', entityId: id },
        tx,
      );
    });
  }

  // ─── Methods used by other modules (accept tx) ──────────────────────────

  async debitStock(
    itemId: string,
    qty: number,
    rentalId: string,
    userId: string,
    tx: Tx,
  ): Promise<void> {
    const item = await tx.item.findUnique({ where: { id: itemId } });
    if (!item || !item.isActive) throw new NotFoundException(`Item ${itemId} not found`);
    if (item.availableQty < qty) {
      throw new BadRequestException(`Insufficient stock for item ${item.code}: available ${item.availableQty}, requested ${qty}`);
    }
    await tx.item.update({
      where: { id: itemId },
      data: { availableQty: { decrement: qty }, rentedQty: { increment: qty } },
    });
    await tx.inventoryMovement.create({
      data: { itemId, userId, rentalId, type: InventoryMovementType.rental_out, quantity: qty },
    });
  }

  async creditStock(
    itemId: string,
    qty: number,
    movementType: InventoryMovementType,
    rentalId: string,
    userId: string,
    tx: Tx,
  ): Promise<void> {
    if (movementType === InventoryMovementType.rental_return) {
      await tx.item.update({
        where: { id: itemId },
        data: { availableQty: { increment: qty }, rentedQty: { decrement: qty } },
      });
    } else if (movementType === InventoryMovementType.maintenance_in) {
      await tx.item.update({
        where: { id: itemId },
        data: { maintenanceQty: { increment: qty }, rentedQty: { decrement: qty } },
      });
    } else if (movementType === InventoryMovementType.deactivation) {
      await tx.item.update({
        where: { id: itemId },
        data: { totalQty: { decrement: qty }, rentedQty: { decrement: qty } },
      });
    }
    await tx.inventoryMovement.create({
      data: { itemId, userId, rentalId, type: movementType, quantity: qty },
    });
  }

  async revertRentalStock(
    itemId: string,
    qty: number,
    rentalId: string,
    userId: string,
    tx: Tx,
  ): Promise<void> {
    await tx.item.update({
      where: { id: itemId },
      data: { availableQty: { increment: qty }, rentedQty: { decrement: qty } },
    });
    await tx.inventoryMovement.create({
      data: { itemId, userId, rentalId, type: InventoryMovementType.rental_reversal, quantity: qty },
    });
  }
}
