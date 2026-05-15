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
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  @Roles(UserRole.admin, UserRole.attendant)
  create(@Body() dto: CreateCustomerDto, @Request() req: any) {
    return this.customersService.create(dto, req.user.id);
  }

  @Get()
  @Roles(UserRole.admin, UserRole.attendant, UserRole.financial)
  findAll(@Query() query: PaginationDto & { name?: string; document?: string }) {
    return this.customersService.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.admin, UserRole.attendant, UserRole.financial)
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.customersService.findById(id);
  }

  @Patch(':id')
  @Roles(UserRole.admin, UserRole.attendant)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
    @Request() req: any,
  ) {
    return this.customersService.update(id, dto, req.user.id);
  }

  @Delete(':id')
  @Roles(UserRole.admin)
  @HttpCode(HttpStatus.NO_CONTENT)
  deactivate(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.customersService.deactivate(id, req.user.id);
  }
}
