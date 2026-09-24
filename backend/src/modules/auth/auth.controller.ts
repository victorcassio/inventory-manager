import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ClientIp } from '../../common/decorators/client-ip.decorator';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { InvitationsService } from '../users/invitations.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ActivateAccountDto } from './dto/activate-account.dto';
import { User } from '@prisma/client';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly passwordService: PasswordService,
    private readonly invitationsService: InvitationsService,
  ) {}

  @Throttle({ global: { ttl: 60_000, limit: 10 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    const user = await this.authService.validateUser(dto.email, dto.password);
    if (!user) {
      throw new UnauthorizedException('Email ou senha inválidos');
    }
    return this.authService.login(user);
  }

  @Throttle({ global: { ttl: 60_000, limit: 15 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshTokenDto) {
    await this.authService.logout(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: User) {
    const { password, ...safeUser } = user;
    return safeUser;
  }

  @Throttle({ global: { ttl: 900_000, limit: 5 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto, @ClientIp() ip: string | undefined) {
    return this.passwordService.requestReset(dto.email, ip);
  }

  @Throttle({ global: { ttl: 900_000, limit: 10 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(@Body() dto: ResetPasswordDto, @ClientIp() ip: string | undefined) {
    await this.passwordService.resetPassword(dto, ip);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ global: { ttl: 900_000, limit: 10 } })
  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(@CurrentUser() user: User, @Body() dto: ChangePasswordDto, @ClientIp() ip: string | undefined) {
    await this.passwordService.changePassword(user.id, dto, ip);
  }

  @Throttle({ global: { ttl: 900_000, limit: 10 } })
  @Post('activate-account')
  @HttpCode(HttpStatus.NO_CONTENT)
  async activateAccount(@Body() dto: ActivateAccountDto, @ClientIp() ip: string | undefined) {
    await this.invitationsService.activate(dto, ip);
  }
}
