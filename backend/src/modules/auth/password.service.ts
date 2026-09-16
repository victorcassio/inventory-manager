import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserActionTokenType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, Tx } from '../audit/audit.service';
import { HashingService } from '../hashing/hashing.service';
import { UserActionTokensService } from '../user-action-tokens/user-action-tokens.service';
import { MAIL_SERVICE, MailService } from '../mail/mail.service';
import { buildPasswordResetEmail } from '../mail/templates/password-reset.template';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

/** The one response the forgot-password endpoint ever returns. */
export const GENERIC_RESET_MESSAGE =
  'Se o e-mail estiver cadastrado, enviaremos as instruções para redefinição da senha.';

/** Per-user throttle: at most this many reset tokens inside the window. */
const RESET_WINDOW_MINUTES = 15;
const RESET_MAX_PER_WINDOW = 3;

@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: UserActionTokensService,
    private readonly hashing: HashingService,
    @Inject(MAIL_SERVICE) private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Always resolves to the same message, whatever the account's state. Every
   * early return below is silent on purpose — distinguishing them would
   * enumerate accounts.
   */
  async requestReset(email: string): Promise<{ message: string }> {
    const normalized = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalized } });

    const eligible = Boolean(user && user.isActive && user.emailVerifiedAt && user.password);
    if (!user || !eligible) {
      return { message: GENERIC_RESET_MESSAGE };
    }

    const recent = await this.tokens.countRecent(
      user.id,
      UserActionTokenType.password_reset,
      RESET_WINDOW_MINUTES,
    );
    if (recent >= RESET_MAX_PER_WINDOW) {
      return { message: GENERIC_RESET_MESSAGE };
    }

    const rawToken = await this.prisma.$transaction(async (tx: Tx) => {
      await this.tokens.revokePending(user.id, UserActionTokenType.password_reset, tx);
      return this.tokens.issue(user.id, UserActionTokenType.password_reset, tx);
    });

    const frontendUrl = this.configService.get<string>('app.frontendUrl');
    // Fragment, not query string: the token never reaches a server log or a Referer.
    const resetUrl = `${frontendUrl}/reset-password#token=${rawToken}`;

    try {
      await this.mail.send({
        to: user.email,
        ...buildPasswordResetEmail({ name: user.name, resetUrl }),
      });
    } catch {
      // The public response must not change. Nothing identifying is logged.
      this.logger.error('Falha ao enviar e-mail de redefinição de senha (detalhes omitidos)');
    }

    // No audit entry: the request is anonymous and AuditLog.userId means "actor".
    return { message: GENERIC_RESET_MESSAGE };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    if (dto.password !== dto.passwordConfirmation) {
      throw new BadRequestException('A confirmação não corresponde à senha');
    }

    const passwordHash = await this.hashing.hash(dto.password);

    await this.prisma.$transaction(async (tx: Tx) => {
      const { userId } = await this.tokens.consume(
        dto.token,
        UserActionTokenType.password_reset,
        tx,
      );

      await tx.user.update({
        where: { id: userId },
        data: { password: passwordHash, passwordChangedAt: new Date() },
      });

      await tx.refreshToken.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true },
      });

      await this.audit.log(
        { userId, action: 'reset_password', entity: 'User', entityId: userId },
        tx,
      );
    });
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user || !user.isActive || !user.emailVerifiedAt || !user.password) {
      throw new UnauthorizedException('Sessão inválida');
    }

    if (dto.newPassword !== dto.newPasswordConfirmation) {
      throw new BadRequestException('A confirmação não corresponde à senha');
    }

    // Cheap pre-check only — the authoritative rule is the hash comparison below.
    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException('A nova senha deve ser diferente da senha atual');
    }

    const current = await this.hashing.verify(user.password, dto.currentPassword);
    if (!current.valid) {
      throw new BadRequestException('Senha atual incorreta');
    }

    const sameAsStored = await this.hashing.verify(user.password, dto.newPassword);
    if (sameAsStored.valid) {
      throw new BadRequestException('A nova senha deve ser diferente da senha atual');
    }

    const passwordHash = await this.hashing.hash(dto.newPassword);

    await this.prisma.$transaction(async (tx: Tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { password: passwordHash, passwordChangedAt: new Date() },
      });

      // Every session ends, including the caller's — the frontend redirects to login.
      await tx.refreshToken.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true },
      });

      await this.audit.log(
        { userId, action: 'change_password', entity: 'User', entityId: userId },
        tx,
      );
    });
  }
}
