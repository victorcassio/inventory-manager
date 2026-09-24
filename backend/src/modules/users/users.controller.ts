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
import { ClientIp } from '../../common/decorators/client-ip.decorator';
import { UsersService } from './users.service';
import { ListUsersDto } from './dto/list-users.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(UserRole.admin)
  findAll(@Query() query: ListUsersDto) {
    return this.usersService.findAllPaginated(query);
  }

  @Post()
  @Roles(UserRole.admin)
  create(@Body() dto: CreateUserDto, @Request() req: any, @ClientIp() ip: string | undefined) {
    return this.usersService.create(dto, req.user.id, ip);
  }

  @Get(':id')
  @Roles(UserRole.admin)
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findByIdOrFail(id);
  }

  @Patch(':id')
  @Roles(UserRole.admin)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @Request() req: any,
    @ClientIp() ip: string | undefined,
  ) {
    return this.usersService.update(id, dto, req.user.id, ip);
  }

  @Patch(':id/status')
  @Roles(UserRole.admin)
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
    @Request() req: any,
    @ClientIp() ip: string | undefined,
  ) {
    return this.usersService.setStatus(id, dto.isActive, req.user.id, ip);
  }

  @Post(':id/resend-invitation')
  @Roles(UserRole.admin)
  @HttpCode(HttpStatus.OK)
  resendInvitation(@Param('id', ParseUUIDPipe) id: string, @Request() req: any, @ClientIp() ip: string | undefined) {
    return this.usersService.resendInvitation(id, req.user.id, ip);
  }

  @Post(':id/revoke-invitation')
  @Roles(UserRole.admin)
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeInvitation(@Param('id', ParseUUIDPipe) id: string, @Request() req: any, @ClientIp() ip: string | undefined) {
    return this.usersService.revokeInvitation(id, req.user.id, ip);
  }
}
