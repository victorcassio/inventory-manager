import { BadRequestException, Injectable } from '@nestjs/common';
import { UserActionToken, UserActionTokenType } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { Tx } from '../audit/audit.service';

/** Time-to-live per token purpose, in minutes. */
export const ACTION_TOKEN_TTL = {
  invitation: 24 * 60,
  password_reset: 30,
} as const;

/** Terminal tokens older than this are pruned opportunistically. */
const RETENTION_DAYS = 30;

const TOKEN_BYTES = 32;

/** The generic message used for every token defect — absent, expired, used, revoked, wrong purpose. */
export const INVALID_TOKEN_MESSAGE = 'Link inválido ou expirado';

/**
 * The projection `findLatest` returns — deliberately WITHOUT `tokenHash`. A
 * digest must never leave this service; callers only ever need enough to
 * derive a status and an expiry.
 */
export type LatestActionToken = Pick<
  UserActionToken,
  'id' | 'userId' | 'type' | 'expiresAt' | 'usedAt' | 'revokedAt' | 'createdAt'
>;

export function hashActionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

@Injectable()
export class UserActionTokensService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a token and returns the RAW value — the only moment it exists
   * outside the e-mail. Only its SHA-256 digest is persisted.
   */
  async issue(userId: string, type: UserActionTokenType, tx?: Tx): Promise<string> {
    const client = tx ?? this.prisma;

    const rawToken = randomBytes(TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(Date.now() + ACTION_TOKEN_TTL[type] * 60_000);

    await client.userActionToken.create({
      data: { userId, type, tokenHash: hashActionToken(rawToken), expiresAt },
    });

    await this.pruneTerminal(userId, client);

    return rawToken;
  }

  /**
   * Validates and consumes in ONE conditional update, so two simultaneous
   * requests cannot both succeed. A preceding lookup would not be enough.
   */
  async consume(
    rawToken: string,
    type: UserActionTokenType,
    tx?: Tx,
  ): Promise<{ userId: string }> {
    const client = tx ?? this.prisma;

    if (typeof rawToken !== 'string' || rawToken.length === 0) {
      throw new BadRequestException(INVALID_TOKEN_MESSAGE);
    }

    const tokenHash = hashActionToken(rawToken);
    const now = new Date();

    const { count } = await client.userActionToken.updateMany({
      where: { tokenHash, type, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });

    if (count !== 1) {
      throw new BadRequestException(INVALID_TOKEN_MESSAGE);
    }

    const consumed = await client.userActionToken.findFirst({
      where: { tokenHash, type },
      select: { userId: true },
    });

    if (!consumed) {
      throw new BadRequestException(INVALID_TOKEN_MESSAGE);
    }

    return { userId: consumed.userId };
  }

  async revokePending(
    userId: string,
    type: UserActionTokenType,
    tx?: Tx,
  ): Promise<number> {
    const client = tx ?? this.prisma;
    const { count } = await client.userActionToken.updateMany({
      where: { userId, type, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count;
  }

  async countRecent(
    userId: string,
    type: UserActionTokenType,
    sinceMinutes: number,
  ): Promise<number> {
    return this.prisma.userActionToken.count({
      where: {
        userId,
        type,
        createdAt: { gte: new Date(Date.now() - sinceMinutes * 60_000) },
      },
    });
  }

  /** Newest token of a type per user, in a single query. Used to derive invitation status. */
  async findLatest(
    userIds: string[],
    type: UserActionTokenType,
  ): Promise<Map<string, LatestActionToken>> {
    const latest = new Map<string, LatestActionToken>();
    if (userIds.length === 0) return latest;

    const tokens = await this.prisma.userActionToken.findMany({
      where: { userId: { in: userIds }, type },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userId: true,
        type: true,
        expiresAt: true,
        usedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });

    // Belt-and-suspenders: pick the max createdAt per user explicitly rather
    // than trusting that the first row per user in the result is the newest.
    // Correctness then does not silently hinge on the `orderBy` above.
    for (const token of tokens) {
      const current = latest.get(token.userId);
      if (!current || token.createdAt > current.createdAt) {
        latest.set(token.userId, token);
      }
    }

    return latest;
  }

  /**
   * Deletes tokens whose TERMINAL timestamp is itself older than the cutoff.
   * A live token is never eligible, whatever its createdAt.
   */
  private async pruneTerminal(userId: string, client: Tx | PrismaService): Promise<void> {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60_000);

    await client.userActionToken.deleteMany({
      where: {
        userId,
        OR: [
          { usedAt: { lt: cutoff } },
          { revokedAt: { lt: cutoff } },
          {
            AND: [
              { usedAt: null },
              { revokedAt: null },
              { expiresAt: { lt: cutoff } },
            ],
          },
        ],
      },
    });
  }
}
