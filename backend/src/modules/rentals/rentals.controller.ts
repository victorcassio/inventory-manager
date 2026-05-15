import {
  Body,
  Controller,
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
import { RentalsService } from './rentals.service';
import { CreateRentalDto } from './dto/create-rental.dto';
import { UpdateRentalDto } from './dto/update-rental.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('rentals')
export class RentalsController {
  constructor(private readonly rentalsService: RentalsService) {}

  @Post()
  @Roles(UserRole.admin, UserRole.attendant)
  createRental(@Body() dto: CreateRentalDto, @Request() req: any) {
    return this.rentalsService.createRental(dto, req.user.id);
  }

  @Get()
  @Roles(UserRole.admin, UserRole.attendant, UserRole.financial)
  findAll(
    @Query()
    query: PaginationDto & {
      status?: string;
      computedStatus?: string;
      customerId?: string;
      contractNumber?: string;
      startDate?: string;
      expectedReturnDate?: string;
    },
  ) {
    return this.rentalsService.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.admin, UserRole.attendant, UserRole.financial)
  findRentalById(@Param('id', ParseUUIDPipe) id: string) {
    return this.rentalsService.findRentalById(id);
  }

  @Patch(':id')
  @Roles(UserRole.admin, UserRole.attendant)
  updateRental(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRentalDto,
    @Request() req: any,
  ) {
    return this.rentalsService.updateRental(id, dto, req.user.id);
  }

  @Post(':id/cancel')
  @Roles(UserRole.admin)
  @HttpCode(HttpStatus.NO_CONTENT)
  cancelRental(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.rentalsService.cancelRental(id, req.user.id);
  }
}
