import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { PaymentMethod, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('rentals/:rentalId/payments')
  @Roles(UserRole.admin, UserRole.financial)
  @HttpCode(HttpStatus.CREATED)
  registerPayment(
    @Param('rentalId', ParseUUIDPipe) rentalId: string,
    @Body() dto: CreatePaymentDto,
    @Request() req: any,
  ) {
    return this.paymentsService.registerPayment(rentalId, dto, req.user.id);
  }

  @Get('rentals/:rentalId/payments')
  @Roles(UserRole.admin, UserRole.attendant, UserRole.financial)
  getPaymentsByRental(@Param('rentalId', ParseUUIDPipe) rentalId: string) {
    return this.paymentsService.getPaymentsByRental(rentalId);
  }

  @Get('payments/:id')
  @Roles(UserRole.admin, UserRole.attendant, UserRole.financial)
  getPaymentById(@Param('id', ParseUUIDPipe) id: string) {
    return this.paymentsService.getPaymentById(id);
  }

  @Get('payments')
  @Roles(UserRole.admin, UserRole.financial)
  listPayments(
    @Query()
    query: PaginationDto & {
      rentalId?: string;
      customerId?: string;
      method?: PaymentMethod;
      dateFrom?: string;
      dateTo?: string;
    },
  ) {
    return this.paymentsService.listPayments(query);
  }
}
