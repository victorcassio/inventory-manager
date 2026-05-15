import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ReturnsService } from './returns.service';
import { CreateReturnDto } from './dto/create-return.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class ReturnsController {
  constructor(private readonly returnsService: ReturnsService) {}

  @Post('rentals/:rentalId/returns')
  @Roles(UserRole.admin, UserRole.attendant)
  @HttpCode(HttpStatus.CREATED)
  registerReturn(
    @Param('rentalId', ParseUUIDPipe) rentalId: string,
    @Body() dto: CreateReturnDto,
    @Request() req: any,
  ) {
    return this.returnsService.registerReturn(rentalId, dto, req.user.id);
  }

  @Get('rentals/:rentalId/returns')
  @Roles(UserRole.admin, UserRole.attendant, UserRole.financial)
  getReturnsByRental(@Param('rentalId', ParseUUIDPipe) rentalId: string) {
    return this.returnsService.getReturnsByRental(rentalId);
  }

  @Get('returns/:id')
  @Roles(UserRole.admin, UserRole.attendant, UserRole.financial)
  getReturnById(@Param('id', ParseUUIDPipe) id: string) {
    return this.returnsService.getReturnById(id);
  }
}
