import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { InventoryService } from './inventory.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  // ─── Categories ─────────────────────────────────────────────────────────

  @Post('categories')
  @Roles(UserRole.admin)
  createCategory(@Body() dto: CreateCategoryDto, @Request() req: any) {
    return this.inventoryService.createCategory(dto, req.user.id);
  }

  @Get('categories')
  @Roles(UserRole.admin, UserRole.attendant, UserRole.financial)
  findAllCategories() {
    return this.inventoryService.findAllCategories();
  }

  @Patch('categories/:id')
  @Roles(UserRole.admin)
  updateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
    @Request() req: any,
  ) {
    return this.inventoryService.updateCategory(id, dto, req.user.id);
  }

  @Delete('categories/:id')
  @Roles(UserRole.admin)
  @HttpCode(HttpStatus.NO_CONTENT)
  deactivateCategory(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.inventoryService.deactivateCategory(id, req.user.id);
  }

  // ─── Items ───────────────────────────────────────────────────────────────

  @Post('items')
  @Roles(UserRole.admin)
  createItem(@Body() dto: CreateItemDto, @Request() req: any) {
    return this.inventoryService.createItem(dto, req.user.id);
  }

  @Get('items')
  @Roles(UserRole.admin, UserRole.attendant, UserRole.financial)
  findAllItems(
    @Query() query: PaginationDto & { categoryId?: string; condition?: string; availableOnly?: string },
  ) {
    return this.inventoryService.findAllItems({
      ...query,
      availableOnly: query.availableOnly === 'true',
    });
  }

  @Get('items/:id')
  @Roles(UserRole.admin, UserRole.attendant, UserRole.financial)
  findItemById(@Param('id', ParseUUIDPipe) id: string) {
    return this.inventoryService.findItemById(id);
  }

  @Patch('items/:id')
  @Roles(UserRole.admin)
  updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateItemDto,
    @Request() req: any,
  ) {
    return this.inventoryService.updateItem(id, dto, req.user.id);
  }

  @Post('items/:id/adjust')
  @Roles(UserRole.admin)
  adjustStock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustStockDto,
    @Request() req: any,
  ) {
    return this.inventoryService.adjustStock(id, dto, req.user.id);
  }

  @Delete('items/:id')
  @Roles(UserRole.admin)
  @HttpCode(HttpStatus.NO_CONTENT)
  deactivateItem(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.inventoryService.deactivateItem(id, req.user.id);
  }
}
