import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { UserActionTokenType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  UserActionTokensService,
  hashActionToken,
  ACTION_TOKEN_TTL,
} from './user-action-tokens.service';
import { deriveInvitationStatus } from '../users/invitations.service';

const mockPrisma = {
  userActionToken: {
    create: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
};

describe('UserActionTokensService', () => {
  let service: UserActionTokensService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserActionTokensService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(UserActionTokensService);
  });

  describe('issue', () => {
    it('returns a high-entropy raw token', async () => {
      mockPrisma.userActionToken.create.mockResolvedValue({});
      const raw = await service.issue('user-1', UserActionTokenType.invitation);
      // 32 random bytes in base64url ≈ 43 characters
      expect(raw.length).toBeGreaterThanOrEqual(43);
      expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('never stores the raw token — only its SHA-256 digest', async () => {
      mockPrisma.userActionToken.create.mockResolvedValue({});
      const raw = await service.issue('user-1', UserActionTokenType.invitation);

      const data = mockPrisma.userActionToken.create.mock.calls[0][0].data;
      expect(data.tokenHash).toBe(hashActionToken(raw));
      expect(data.tokenHash).toHaveLength(64);
      expect(JSON.stringify(data)).not.toContain(raw);
    });

    it('issues an invitation valid for 24 hours', async () => {
      mockPrisma.userActionToken.create.mockResolvedValue({});
      const before = Date.now();
      await service.issue('user-1', UserActionTokenType.invitation);

      const { expiresAt } = mockPrisma.userActionToken.create.mock.calls[0][0].data;
      const minutes = (new Date(expiresAt).getTime() - before) / 60_000;
      expect(Math.round(minutes)).toBe(ACTION_TOKEN_TTL.invitation);
    });

    it('issues a password reset valid for 30 minutes', async () => {
      mockPrisma.userActionToken.create.mockResolvedValue({});
      const before = Date.now();
      await service.issue('user-1', UserActionTokenType.password_reset);

      const { expiresAt } = mockPrisma.userActionToken.create.mock.calls[0][0].data;
      const minutes = (new Date(expiresAt).getTime() - before) / 60_000;
      expect(Math.round(minutes)).toBe(ACTION_TOKEN_TTL.password_reset);
    });

    it('prunes only tokens whose terminal timestamp is past the retention cutoff', async () => {
      mockPrisma.userActionToken.create.mockResolvedValue({});
      await service.issue('user-1', UserActionTokenType.invitation);

      const where = mockPrisma.userActionToken.deleteMany.mock.calls[0][0].where;
      expect(where.userId).toBe('user-1');
      expect(where.OR).toEqual([
        { usedAt: { lt: expect.any(Date) } },
        { revokedAt: { lt: expect.any(Date) } },
        {
          AND: [
            { usedAt: null },
            { revokedAt: null },
            { expiresAt: { lt: expect.any(Date) } },
          ],
        },
      ]);
      // A live token is never matched by any branch above.
      expect(JSON.stringify(where)).not.toContain('createdAt');
    });
  });

  describe('consume', () => {
    it('validates and marks used in a single conditional update', async () => {
      mockPrisma.userActionToken.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.userActionToken.findFirst.mockResolvedValue({ userId: 'user-1' });

      const result = await service.consume('raw-token', UserActionTokenType.invitation);

      expect(result).toEqual({ userId: 'user-1' });
      const where = mockPrisma.userActionToken.updateMany.mock.calls[0][0].where;
      expect(where).toEqual({
        tokenHash: hashActionToken('raw-token'),
        type: UserActionTokenType.invitation,
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      });
    });

    it('rejects when no row was updated', async () => {
      mockPrisma.userActionToken.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.consume('raw-token', UserActionTokenType.invitation),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('uses the same generic message for every defect', async () => {
      mockPrisma.userActionToken.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.consume('raw-token', UserActionTokenType.invitation),
      ).rejects.toThrow('Link inválido ou expirado');
    });

    it('never puts the raw token in the exception', async () => {
      mockPrisma.userActionToken.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.consume('SUPER_SECRET_TOKEN', UserActionTokenType.invitation),
      ).rejects.not.toThrow(/SUPER_SECRET_TOKEN/);
    });

    it('rejects a token presented for the wrong purpose', async () => {
      mockPrisma.userActionToken.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.consume('raw-token', UserActionTokenType.password_reset),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.userActionToken.updateMany.mock.calls[0][0].where.type).toBe(
        UserActionTokenType.password_reset,
      );
    });
  });

  describe('revokePending', () => {
    it('revokes only tokens that are still pending', async () => {
      mockPrisma.userActionToken.updateMany.mockResolvedValue({ count: 2 });

      const count = await service.revokePending('user-1', UserActionTokenType.invitation);

      expect(count).toBe(2);
      expect(mockPrisma.userActionToken.updateMany.mock.calls[0][0].where).toEqual({
        userId: 'user-1',
        type: UserActionTokenType.invitation,
        usedAt: null,
        revokedAt: null,
      });
    });
  });

  describe('countRecent', () => {
    it('counts tokens of one type created within the window', async () => {
      mockPrisma.userActionToken.count.mockResolvedValue(3);

      const count = await service.countRecent('user-1', UserActionTokenType.password_reset, 15);

      expect(count).toBe(3);
      const where = mockPrisma.userActionToken.count.mock.calls[0][0].where;
      expect(where.userId).toBe('user-1');
      expect(where.type).toBe(UserActionTokenType.password_reset);
      expect(where.createdAt.gte).toBeInstanceOf(Date);
    });
  });

  describe('findLatest', () => {
    it('returns the newest token per user in one query', async () => {
      mockPrisma.userActionToken.findMany.mockResolvedValue([
        { id: 't2', userId: 'user-1', createdAt: new Date('2026-09-10') },
        { id: 't1', userId: 'user-1', createdAt: new Date('2026-09-01') },
        { id: 't3', userId: 'user-2', createdAt: new Date('2026-09-05') },
      ]);

      const map = await service.findLatest(['user-1', 'user-2'], UserActionTokenType.invitation);

      expect(mockPrisma.userActionToken.findMany).toHaveBeenCalledTimes(1);
      expect(map.get('user-1')?.id).toBe('t2');
      expect(map.get('user-2')?.id).toBe('t3');
    });

    it('queries ordered newest-first and never selects tokenHash', async () => {
      mockPrisma.userActionToken.findMany.mockResolvedValue([]);
      await service.findLatest(['user-1'], UserActionTokenType.invitation);

      const call = mockPrisma.userActionToken.findMany.mock.calls[0][0];
      expect(call.orderBy).toEqual({ createdAt: 'desc' });
      expect(call.select).toEqual({
        id: true,
        userId: true,
        type: true,
        expiresAt: true,
        usedAt: true,
        revokedAt: true,
        createdAt: true,
      });
      expect(call.select).not.toHaveProperty('tokenHash');
    });

    it('still selects the newest token per user even if the mock returns ascending order', async () => {
      // A pre-sorted-descending mock (as in the first test above) would pass
      // identically even if the implementation asked Prisma for `asc` order.
      // Feeding ascending data here proves the newest-per-user selection does
      // not silently depend on the caller/DB having pre-sorted the rows.
      mockPrisma.userActionToken.findMany.mockResolvedValue([
        { id: 't1', userId: 'user-1', createdAt: new Date('2026-09-01') },
        { id: 't2', userId: 'user-1', createdAt: new Date('2026-09-10') },
        { id: 't3', userId: 'user-2', createdAt: new Date('2026-09-05') },
      ]);

      const map = await service.findLatest(['user-1', 'user-2'], UserActionTokenType.invitation);

      expect(map.get('user-1')?.id).toBe('t2');
      expect(map.get('user-2')?.id).toBe('t3');
    });

    it('returns an empty map for no users without querying', async () => {
      const map = await service.findLatest([], UserActionTokenType.invitation);
      expect(map.size).toBe(0);
      expect(mockPrisma.userActionToken.findMany).not.toHaveBeenCalled();
    });

    it('resend-after-revoke: an older revoked token never masks a newer live one', async () => {
      // The realistic shape an admin hits every time they resend an
      // invitation: the old token is revoked, a fresh one is issued after it.
      mockPrisma.userActionToken.findMany.mockResolvedValue([
        {
          id: 'old',
          userId: 'user-1',
          type: UserActionTokenType.invitation,
          expiresAt: new Date('2026-09-02'),
          usedAt: null,
          revokedAt: new Date('2026-09-02T00:05:00Z'),
          createdAt: new Date('2026-09-01'),
        },
        {
          id: 'new',
          userId: 'user-1',
          type: UserActionTokenType.invitation,
          expiresAt: new Date('2099-01-01'),
          usedAt: null,
          revokedAt: null,
          createdAt: new Date('2026-09-02'),
        },
      ]);

      const map = await service.findLatest(['user-1'], UserActionTokenType.invitation);
      const latest = map.get('user-1');

      expect(latest?.id).toBe('new');
      expect(
        deriveInvitationStatus({ passwordSetAt: null }, latest, new Date('2026-09-03')),
      ).toBe('pending');
    });
  });
});
