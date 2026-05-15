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
import {
  FinancialTransactionCategory,
  FinancialTransactionOrigin,
  FinancialTransactionType,
  UserRole,
} from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { FinancialService } from './financial.service';
import { CreateFinancialTransactionDto } from './dto/create-financial-transaction.dto';
import { UpdateFinancialTransactionDto } from './dto/update-financial-transaction.dto';
import { VoidFinancialTransactionDto } from './dto/void-financial-transaction.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('financial/transactions')
export class FinancialController {
  constructor(private readonly financialService: FinancialService) {}

  @Post()
  @Roles(UserRole.admin, UserRole.financial)
  createManualTransaction(
    @Body() dto: CreateFinancialTransactionDto,
    @Request() req: any,
  ) {
    return this.financialService.createManualTransaction(dto, req.user.id);
  }

  @Get()
  @Roles(UserRole.admin, UserRole.financial)
  listTransactions(
    @Query()
    query: PaginationDto & {
      type?: FinancialTransactionType;
      category?: FinancialTransactionCategory;
      origin?: FinancialTransactionOrigin;
      isVoided?: string;
      rentalId?: string;
      paymentId?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ) {
    return this.financialService.listTransactions({
      ...query,
      isVoided: query.isVoided !== undefined ? query.isVoided === 'true' : undefined,
    });
  }

  @Get(':id')
  @Roles(UserRole.admin, UserRole.financial)
  getTransactionById(@Param('id', ParseUUIDPipe) id: string) {
    return this.financialService.getTransactionById(id);
  }

  @Patch(':id')
  @Roles(UserRole.admin, UserRole.financial)
  updateManualTransaction(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFinancialTransactionDto,
    @Request() req: any,
  ) {
    return this.financialService.updateManualTransaction(id, dto, req.user.id);
  }

  @Delete(':id')
  @Roles(UserRole.admin)
  @HttpCode(HttpStatus.NO_CONTENT)
  voidManualTransaction(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidFinancialTransactionDto,
    @Request() req: any,
  ) {
    return this.financialService.voidManualTransaction(id, dto, req.user.id);
  }
}
