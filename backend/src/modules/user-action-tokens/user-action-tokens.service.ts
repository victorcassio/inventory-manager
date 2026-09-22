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

/** Never a real row's id — used only to shape a no-op query/transaction. */
const DUMMY_USER_ID = '00000000-0000-0000-0000-000000000000';

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

  /**
   * Cheap existence/validity check, BEFORE the caller pays Argon2id's cost
   * (memoryCost 64 MiB, timeCost 3) on what may be an obviously-dead token.
   * Read-only: never marks anything used, never returns the digest or any
   * field beyond the three needed to decide, and applies exactly the same
   * criteria `consume()` enforces atomically (type match, unused,
   * unrevoked, unexpired) — so a token this method calls valid but that
   * `consume()` later rejects is a real race (concurrent use/revocation/
   * expiry between the two calls), not a mismatch between their rules.
   *
   * This is an optimization, not a security boundary: `consume()`'s atomic
   * conditional update remains the only thing that actually authorizes
   * single-use. Skipping this check entirely would only cost more CPU on
   * invalid tokens, never a security regression — which is exactly what
   * the mutation check for this fix (moving hash() before the preflight)
   * has to prove by making the "did not call hash()" tests fail.
   */
  async looksValid(rawToken: string, type: UserActionTokenType): Promise<boolean> {
    if (typeof rawToken !== 'string' || rawToken.length === 0) return false;

    const tokenHash = hashActionToken(rawToken);
    const token = await this.prisma.userActionToken.findFirst({
      where: { tokenHash, type },
      select: { usedAt: true, revokedAt: true, expiresAt: true },
    });

    if (!token) return false;
    return !token.usedAt && !token.revokedAt && token.expiresAt > new Date();
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

  /**
   * Approximates the round-trip cost `requestReset()` spends on an eligible
   * account — a count query, then a transaction with three writes
   * (`revokePending`'s `updateMany`, `issue()`'s `create`, and its
   * `pruneTerminal`'s `deleteMany`) — without touching any real row. Called
   * on the ineligible branch so response latency cannot be used to
   * enumerate accounts; same rationale as `HashingService.verifyDummy()`
   * for the login path. `create` itself cannot be mirrored (it would need a
   * real `users.id` to satisfy the foreign key), so a second no-op
   * `updateMany` stands in for its write cost instead — the three
   * statements below are not byte-for-byte identical to the real path, but
   * match its shape (1 read, then 3 writes in one transaction) closely
   * enough that the difference is sub-millisecond, not response-time
   * distinguishable.
   */
  async payDummyIssueCost(type: UserActionTokenType, sinceMinutes: number): Promise<void> {
    await this.prisma.userActionToken.count({
      where: {
        userId: DUMMY_USER_ID,
        type,
        createdAt: { gte: new Date(Date.now() - sinceMinutes * 60_000) },
      },
    });

    await this.prisma.$transaction(async (tx: Tx) => {
      await tx.userActionToken.updateMany({
        where: { userId: DUMMY_USER_ID, type, usedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      // Stands in for issue()'s create — see the doc comment above.
      await tx.userActionToken.updateMany({
        where: { userId: DUMMY_USER_ID, type, usedAt: { not: null } },
        data: { revokedAt: new Date() },
      });
      await tx.userActionToken.deleteMany({
        where: { userId: DUMMY_USER_ID, type, id: DUMMY_USER_ID },
      });
    });
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
