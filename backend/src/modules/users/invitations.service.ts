import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserActionToken, UserActionTokenType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, Tx } from '../audit/audit.service';
import { HashingService } from '../hashing/hashing.service';
import {
  INVALID_TOKEN_MESSAGE,
  UserActionTokensService,
} from '../user-action-tokens/user-action-tokens.service';
import { MAIL_SERVICE, MailService } from '../mail/mail.service';
import { buildInvitationEmail } from '../mail/templates/invitation.template';
import { ActivateAccountDto } from '../auth/dto/activate-account.dto';

export type InvitationStatus = 'none' | 'pending' | 'expired' | 'revoked' | 'accepted';

/** The only fields `deriveInvitationStatus` reads off a token. */
export type InvitationStatusToken = Pick<UserActionToken, 'usedAt' | 'revokedAt' | 'expiresAt'>;

/**
 * Deterministic precedence, first match wins. Derived rather than stored: a
 * persisted status has to be kept in sync with token expiry and eventually lies.
 */
export function deriveInvitationStatus(
  user: { passwordSetAt: Date | null },
  latest: InvitationStatusToken | undefined,
  now: Date = new Date(),
): InvitationStatus {
  if (user.passwordSetAt) return 'accepted';
  if (!latest) return 'none';

  const live = !latest.usedAt && !latest.revokedAt && latest.expiresAt > now;
  if (live) return 'pending';

  if (latest.revokedAt) return 'revoked';
  return 'expired';
}

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: UserActionTokensService,
    private readonly hashing: HashingService,
    @Inject(MAIL_SERVICE) private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Issues a fresh invitation and attempts delivery.
   *
   * Returns whether the mail was accepted. A delivery failure NEVER throws and
   * never rolls back the token: the caller reports invitationEmailSent: false
   * so the admin can resend against the same user instead of creating a duplicate.
   *
   * This is deliberately AWAITED, unlike PasswordService.requestReset()'s
   * fire-and-forget send: this method is only reachable from admin-authenticated
   * flows where the caller already knows the account exists, so there is no
   * account-enumeration timing oracle to protect against here — and the admin
   * is entitled to know whether delivery actually succeeded.
   */
  async sendInvitation(userId: string, tx?: Tx): Promise<boolean> {
    const user = await (tx ?? this.prisma).user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const issue = async (client: Tx) => {
      await this.tokens.revokePending(userId, UserActionTokenType.invitation, client);
      return this.tokens.issue(userId, UserActionTokenType.invitation, client);
    };

    const rawToken = tx ? await issue(tx) : await this.prisma.$transaction(issue);

    const frontendUrl = this.configService.get<string>('app.frontendUrl');
    // Fragment, not query string: the token never reaches a server log or a Referer.
    const activationUrl = `${frontendUrl}/activate-account#token=${rawToken}`;

    try {
      await this.mail.send({
        to: user.email,
        ...buildInvitationEmail({ name: user.name, activationUrl }),
      });
      return true;
    } catch {
      this.logger.error('Falha ao enviar e-mail de convite (detalhes omitidos)');
      return false;
    }
  }

  /**
   * Consumes the invitation token, sets the password and both verification
   * timestamps, and revokes any other outstanding invitation for the
   * account — all in ONE transaction, so a failure anywhere rolls back the
   * token's usedAt too and a valid token is never burned without the
   * password being set.
   *
   * Returns nothing and does not authenticate: the frontend sends the user
   * to the login screen after this resolves.
   */
  async activate(dto: ActivateAccountDto, ipAddress?: string): Promise<void> {
    // Cheap check BEFORE Argon2id: an obviously dead token (wrong type,
    // absent, expired, used, revoked) is rejected without paying the
    // hashing cost. Not a security boundary — consume()'s atomic
    // conditional update below is what actually enforces single-use; this
    // only decides whether hash() runs at all.
    const looksValid = await this.tokens.looksValid(dto.token, UserActionTokenType.invitation);
    if (!looksValid) {
      throw new BadRequestException(INVALID_TOKEN_MESSAGE);
    }

    const passwordHash = await this.hashing.hash(dto.password);

    await this.prisma.$transaction(async (tx: Tx) => {
      const { userId } = await this.tokens.consume(
        dto.token,
        UserActionTokenType.invitation,
        tx,
      );

      // Conditioned on isActive, not a plain update: if the account was
      // deactivated after the preflight check above (or between consume()
      // and here), this matches zero rows and the throw below rolls back
      // the WHOLE transaction — including consume()'s usedAt write, so a
      // token rejected this way is never left marked used. Defense in
      // depth alongside setStatus() revoking pending invitations on
      // deactivation: that closes the door first, this is the door
      // staying shut even if some future path deactivates a user without
      // going through setStatus().
      const now = new Date();
      const { count } = await tx.user.updateMany({
        where: { id: userId, isActive: true },
        data: {
          password: passwordHash,
          emailVerifiedAt: now,
          passwordSetAt: now,
        },
      });

      if (count !== 1) {
        throw new BadRequestException(INVALID_TOKEN_MESSAGE);
      }

      // Any other invitation still outstanding for this account is now moot.
      await this.tokens.revokePending(userId, UserActionTokenType.invitation, tx);

      await this.audit.log(
        {
          userId,
          action: 'activate_account',
          entity: 'User',
          entityId: userId,
          ipAddress,
        },
        tx,
      );
    });

    // Deliberately no tokens returned: the user is sent to the login screen.
  }

  async revoke(userId: string, actorId: string, ipAddress?: string): Promise<void> {
    await this.prisma.$transaction(async (tx: Tx) => {
      const revoked = await this.tokens.revokePending(
        userId,
        UserActionTokenType.invitation,
        tx,
      );

      if (revoked === 0) {
        throw new NotFoundException('Nenhum convite pendente para este usuário');
      }

      await this.audit.log(
        {
          userId: actorId,
          action: 'revoke_user_invitation',
          entity: 'User',
          entityId: userId,
          ipAddress,
        },
        tx,
      );
    });
  }
}
