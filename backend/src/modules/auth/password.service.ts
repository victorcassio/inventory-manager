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
import {
  INVALID_TOKEN_MESSAGE,
  UserActionTokensService,
} from '../user-action-tokens/user-action-tokens.service';
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
  async requestReset(email: string, ipAddress?: string): Promise<{ message: string }> {
    // The only forensic trail a reset request leaves: no AuditLog row is
    // written (the request is anonymous — see resetPassword/changePassword
    // for the attributed alternative), so this operational line is it. It is
    // emitted unconditionally, before any branching on account state, and
    // its content never varies with eligibility — otherwise the log itself
    // would become an account-existence oracle for anyone reading it.
    this.logger.log(`[password-reset] solicitação recebida ip=${ipAddress ?? 'desconhecido'}`);

    const normalized = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalized } });

    const eligible = Boolean(user && user.isActive && user.emailVerifiedAt && user.password);
    if (!eligible) {
      // Approximates the round-trip cost the branch below spends (a count
      // query, then a transaction with three writes) so response latency
      // cannot be used to enumerate accounts — mirrors
      // HashingService.verifyDummy()'s rationale for the login path.
      // Without this, a nonexistent/ineligible address answers faster than
      // an eligible one every single time. See
      // UserActionTokensService.payDummyIssueCost for the exact shape and
      // its limits.
      await this.tokens.payDummyIssueCost(UserActionTokenType.password_reset, RESET_WINDOW_MINUTES);
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

    // Deliberately NOT awaited. Awaiting the SMTP dialogue would make an
    // eligible address answer hundreds of milliseconds slower than a
    // nonexistent one, turning response latency into an account-existence
    // oracle that the uniform response body is meant to prevent. The .catch
    // is mandatory — an unhandled rejection would crash the process on some
    // Node configurations.
    void this.mail
      .send({
        to: user.email,
        ...buildPasswordResetEmail({ name: user.name, resetUrl }),
      })
      .catch(() => {
        // The public response must not change. Nothing identifying is logged.
        this.logger.error('Falha ao enviar e-mail de redefinição de senha (detalhes omitidos)');
      });

    // No audit entry: the request is anonymous and AuditLog.userId means "actor".
    return { message: GENERIC_RESET_MESSAGE };
  }

  async resetPassword(dto: ResetPasswordDto, ipAddress?: string): Promise<void> {
    if (dto.password !== dto.passwordConfirmation) {
      throw new BadRequestException('A confirmação não corresponde à senha');
    }

    // Cheap check BEFORE Argon2id — see InvitationsService.activate() for
    // the identical rationale. Not a security boundary; consume() below is.
    const looksValid = await this.tokens.looksValid(dto.token, UserActionTokenType.password_reset);
    if (!looksValid) {
      throw new BadRequestException(INVALID_TOKEN_MESSAGE);
    }

    const passwordHash = await this.hashing.hash(dto.password);

    await this.prisma.$transaction(async (tx: Tx) => {
      const { userId } = await this.tokens.consume(
        dto.token,
        UserActionTokenType.password_reset,
        tx,
      );

      // Conditioned on the account still being eligible, not a plain
      // update: if it was deactivated (or otherwise lost eligibility)
      // after the preflight check above, this matches zero rows and the
      // throw below rolls back the whole transaction — including
      // consume()'s usedAt write, so the token is never left marked used
      // for a reset that did not actually happen. Same eligibility
      // definition used everywhere else in this file (requestReset) and
      // in AuthService.validateUser. Defense in depth alongside
      // setStatus() revoking pending reset tokens on deactivation.
      const { count } = await tx.user.updateMany({
        where: {
          id: userId,
          isActive: true,
          emailVerifiedAt: { not: null },
          password: { not: null },
        },
        data: { password: passwordHash, passwordChangedAt: new Date() },
      });

      if (count !== 1) {
        throw new BadRequestException(INVALID_TOKEN_MESSAGE);
      }

      await tx.refreshToken.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true },
      });

      await this.audit.log(
        { userId, action: 'reset_password', entity: 'User', entityId: userId, ipAddress },
        tx,
      );
    });
  }

  async changePassword(userId: string, dto: ChangePasswordDto, ipAddress?: string): Promise<void> {
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

    // Captured BEFORE hash(): Argon2id (memoryCost 64 MiB, timeCost 3) takes
    // long enough that a concurrent reset/change/deactivation can complete
    // entirely while this call is still hashing. The write below is
    // conditioned on the stored hash still being EXACTLY this value, so
    // that race loses cleanly — the stale request's write matches zero
    // rows — instead of silently overwriting whatever won in the meantime.
    // A plain re-read right before the write would still leave a TOCTOU gap
    // between the read and the write; the guarantee has to be in the write
    // itself, which is why this is a conditional updateMany, not a second
    // findUnique followed by an unconditional update.
    const verifiedAgainstHash = user.password;
    const passwordHash = await this.hashing.hash(dto.newPassword);

    await this.prisma.$transaction(async (tx: Tx) => {
      const { count } = await tx.user.updateMany({
        where: {
          id: userId,
          password: verifiedAgainstHash,
          isActive: true,
          emailVerifiedAt: { not: null },
        },
        data: { password: passwordHash, passwordChangedAt: new Date() },
      });

      if (count !== 1) {
        // The account was deactivated, or its password already changed by
        // a concurrent reset/change that got there first — safe, generic
        // failure. Nothing below this line runs: no session is revoked
        // (they belong to whichever operation actually won) and no
        // success is audited.
        throw new UnauthorizedException('Sessão inválida');
      }

      // Every session ends, including the caller's — the frontend redirects to login.
      await tx.refreshToken.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true },
      });

      await this.audit.log(
        { userId, action: 'change_password', entity: 'User', entityId: userId, ipAddress },
        tx,
      );
    });
  }
}
