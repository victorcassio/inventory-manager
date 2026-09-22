import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserActionTokenType, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { HashingService } from '../hashing/hashing.service';
import { UserActionTokensService } from '../user-action-tokens/user-action-tokens.service';
import { MAIL_SERVICE } from '../mail/mail.service';
import { PasswordService, GENERIC_RESET_MESSAGE } from './password.service';

const user = {
  id: 'user-1',
  name: 'Maria',
  email: 'maria@test.com',
  password: '$argon2id$current',
  role: UserRole.attendant,
  isActive: true,
  emailVerifiedAt: new Date('2026-01-01'),
  passwordSetAt: new Date('2026-01-01'),
  passwordChangedAt: null,
  lastLogin: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockPrisma = {
  user: { findUnique: jest.fn(), updateMany: jest.fn() },
  refreshToken: { updateMany: jest.fn() },
  $transaction: jest.fn(),
};
const mockTokens = {
  issue: jest.fn(),
  consume: jest.fn(),
  revokePending: jest.fn(),
  countRecent: jest.fn(),
  payDummyIssueCost: jest.fn(),
  looksValid: jest.fn(),
};

/**
 * A promise plus its own resolve function, exposed separately — lets a test
 * control exactly when an awaited step completes instead of relying on real
 * elapsed time. Used below to interleave two "concurrent" service calls in a
 * fixed, repeatable order.
 */
function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}
const mockHashing = { hash: jest.fn(), verify: jest.fn(), rehashLegacy: jest.fn() };
const mockMail = { send: jest.fn() };
const mockAudit = { log: jest.fn() };
const mockConfig = {
  get: jest.fn().mockImplementation((k: string) =>
    k === 'app.frontendUrl' ? 'http://localhost:5173' : undefined,
  ),
};

describe('PasswordService', () => {
  let service: PasswordService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // jest.clearAllMocks() clears call history but NOT queued
    // mockResolvedValueOnce() implementations — a test that queues one and
    // then short-circuits before consuming it (see "rejects the
    // plaintext-identical case early") would otherwise leak that value into
    // the next test's first verify() call. Reset this mock specifically;
    // mockConfig.get's implementation must survive across tests, so a blanket
    // jest.resetAllMocks() is not used here.
    mockHashing.verify.mockReset();
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
    mockTokens.countRecent.mockResolvedValue(0);
    mockTokens.revokePending.mockResolvedValue(0);
    mockTokens.issue.mockResolvedValue('RAW_TOKEN');
    mockTokens.looksValid.mockResolvedValue(true);
    // requestReset() fires this off without awaiting it — it must always
    // return a real promise (not undefined) for the unawaited .catch() to
    // attach to. Individual tests override this with mockRejectedValue /
    // a never-settling promise as needed.
    mockMail.send.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PasswordService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: UserActionTokensService, useValue: mockTokens },
        { provide: HashingService, useValue: mockHashing },
        { provide: MAIL_SERVICE, useValue: mockMail },
        { provide: AuditService, useValue: mockAudit },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get(PasswordService);
  });

  describe('requestReset', () => {
    it('returns the generic message for an existing eligible user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(user);
      await expect(service.requestReset('maria@test.com')).resolves.toEqual({
        message: GENERIC_RESET_MESSAGE,
      });
    });

    it('returns the identical message for a nonexistent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.requestReset('ninguem@test.com')).resolves.toEqual({
        message: GENERIC_RESET_MESSAGE,
      });
    });

    it.each([
      ['inactive', { ...user, isActive: false }],
      ['unverified', { ...user, emailVerifiedAt: null }],
      ['passwordless', { ...user, password: null }],
    ])('returns the identical message for an %s user and sends nothing', async (_l, found) => {
      mockPrisma.user.findUnique.mockResolvedValue(found);
      await expect(service.requestReset('maria@test.com')).resolves.toEqual({
        message: GENERIC_RESET_MESSAGE,
      });
      expect(mockMail.send).not.toHaveBeenCalled();
    });

    it.each([
      ['nonexistent', null],
      ['inactive', { ...user, isActive: false }],
      ['unverified', { ...user, emailVerifiedAt: null }],
      ['passwordless', { ...user, password: null }],
    ])(
      'pays the same round-trip cost as an eligible request for a(n) %s account, instead of returning immediately',
      async (_l, found) => {
        mockPrisma.user.findUnique.mockResolvedValue(found);
        await service.requestReset('maria@test.com');
        expect(mockTokens.payDummyIssueCost).toHaveBeenCalledWith(
          UserActionTokenType.password_reset,
          15,
        );
        expect(mockTokens.countRecent).not.toHaveBeenCalled();
        expect(mockTokens.revokePending).not.toHaveBeenCalled();
        expect(mockTokens.issue).not.toHaveBeenCalled();
      },
    );

    it('does not pay the dummy cost for an eligible account', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(user);
      await service.requestReset('maria@test.com');
      expect(mockTokens.payDummyIssueCost).not.toHaveBeenCalled();
    });

    it('normalizes the e-mail before lookup', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await service.requestReset('  MARIA@TEST.COM  ');
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'maria@test.com' },
      });
    });

    it('revokes previous reset tokens before issuing a new one', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(user);
      await service.requestReset('maria@test.com');
      expect(mockTokens.revokePending).toHaveBeenCalledWith(
        'user-1',
        UserActionTokenType.password_reset,
        expect.anything(),
      );
    });

    it('builds the reset link with the token in the URL fragment', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(user);
      await service.requestReset('maria@test.com');
      const sent = mockMail.send.mock.calls[0][0];
      expect(sent.text).toContain('http://localhost:5173/reset-password#token=RAW_TOKEN');
      expect(sent.text).not.toContain('?token=');
    });

    it('skips sending once the per-user window limit is reached', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockTokens.countRecent.mockResolvedValue(3);

      await expect(service.requestReset('maria@test.com')).resolves.toEqual({
        message: GENERIC_RESET_MESSAGE,
      });
      expect(mockMail.send).not.toHaveBeenCalled();
      expect(mockTokens.issue).not.toHaveBeenCalled();
    });

    it('returns the same successful response when SMTP throws', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockMail.send.mockRejectedValue(new Error('SMTP down'));

      await expect(service.requestReset('maria@test.com')).resolves.toEqual({
        message: GENERIC_RESET_MESSAGE,
      });
    });

    it('logs an SMTP failure without the token, URL or recipient', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockMail.send.mockRejectedValue(new Error('SMTP down'));
      const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await service.requestReset('maria@test.com');

      const logged = spy.mock.calls.map(c => String(c[0])).join(' ');
      expect(logged).not.toContain('RAW_TOKEN');
      expect(logged).not.toContain('maria@test.com');
      expect(logged).not.toContain('reset-password');
      spy.mockRestore();
    });

    it('does not write an audit entry attributing the request to the user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(user);
      await service.requestReset('maria@test.com');

      const actions = mockAudit.log.mock.calls.map(c => c[0].action);
      expect(actions).not.toContain('request_password_reset');
    });

    it('resolves without waiting on a pending (never-settling) SMTP send', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(user);
      // A promise that never resolves or rejects — if requestReset awaited
      // this, the test would time out. It must not.
      mockMail.send.mockReturnValue(new Promise<void>(() => {}));

      await expect(service.requestReset('maria@test.com')).resolves.toEqual({
        message: GENERIC_RESET_MESSAGE,
      });
    });

    it('emits an identical operational log line for an eligible and an ineligible address', async () => {
      const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

      mockPrisma.user.findUnique.mockResolvedValue(user);
      await service.requestReset('maria@test.com', '203.0.113.7');
      const eligibleLine = spy.mock.calls[0][0];

      spy.mockClear();

      mockPrisma.user.findUnique.mockResolvedValue(null);
      await service.requestReset('ninguem@test.com', '203.0.113.7');
      const ineligibleLine = spy.mock.calls[0][0];

      expect(eligibleLine).toBe(ineligibleLine);
      expect(String(eligibleLine)).toContain('203.0.113.7');
      spy.mockRestore();
    });
  });

  describe('resetPassword', () => {
    const dto = {
      token: 'RAW_TOKEN',
      password: 'uma senha bem comprida',
      passwordConfirmation: 'uma senha bem comprida',
    };

    beforeEach(() => {
      mockTokens.consume.mockResolvedValue({ userId: 'user-1' });
      mockHashing.hash.mockResolvedValue('$argon2id$new');
      mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });
    });

    it('writes the new hash and stamps passwordChangedAt', async () => {
      await service.resetPassword(dto);

      const call = mockPrisma.user.updateMany.mock.calls[0][0];
      expect(call.data.password).toBe('$argon2id$new');
      expect(call.data.passwordChangedAt).toBeInstanceOf(Date);
    });

    it('conditions the write on the user still being eligible', async () => {
      await service.resetPassword(dto);

      const where = mockPrisma.user.updateMany.mock.calls[0][0].where;
      expect(where).toEqual({
        id: 'user-1',
        isActive: true,
        emailVerifiedAt: { not: null },
        password: { not: null },
      });
    });

    it('revokes every refresh token for the user', async () => {
      await service.resetPassword(dto);
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revoked: false },
        data: { revoked: true },
      });
    });

    it('runs inside a single transaction', async () => {
      await service.resetPassword(dto);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('rejects an invalid token generically and changes nothing', async () => {
      mockTokens.consume.mockRejectedValue(new BadRequestException('Link inválido ou expirado'));

      await expect(service.resetPassword(dto)).rejects.toThrow('Link inválido ou expirado');
      expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('rejects with the generic message, before hashing, when the preflight finds the token invalid', async () => {
      mockTokens.looksValid.mockResolvedValue(false);

      await expect(service.resetPassword(dto)).rejects.toThrow('Link inválido ou expirado');
      expect(mockHashing.hash).not.toHaveBeenCalled();
      expect(mockTokens.consume).not.toHaveBeenCalled();
      expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(mockAudit.log).not.toHaveBeenCalled();
    });

    it('runs the preflight against the password_reset type, and still hashes exactly once for a token that passes it', async () => {
      // Ordering (preflight before hash) is established by the adjacent
      // "rejects with the generic message, before hashing, when the
      // preflight finds the token invalid" test; this one only checks the
      // type passed to looksValid() and that the happy path still hashes.
      await service.resetPassword(dto);
      expect(mockTokens.looksValid).toHaveBeenCalledWith(dto.token, UserActionTokenType.password_reset);
      expect(mockHashing.hash).toHaveBeenCalledTimes(1);
    });

    it('does not change the password when the account is no longer eligible, even though consume() accepted the token', async () => {
      // Isolates the defense-in-depth guard from token revocation: consume()
      // succeeding (nothing here makes it reject) is exactly what makes
      // this NOT the "token already revoked" path.
      mockPrisma.user.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.resetPassword(dto)).rejects.toThrow('Link inválido ou expirado');

      expect(mockTokens.consume).toHaveBeenCalled();
      expect(mockPrisma.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(mockAudit.log).not.toHaveBeenCalled();
    });

    it('audits without password, token or pepper', async () => {
      await service.resetPassword(dto);

      const entry = mockAudit.log.mock.calls.find(c => c[0].action === 'reset_password')?.[0];
      expect(entry).toBeDefined();
      const serialized = JSON.stringify(entry);
      expect(serialized).not.toContain('uma senha bem comprida');
      expect(serialized).not.toContain('RAW_TOKEN');
      expect(serialized).not.toContain('$argon2id$');
    });

    it('calls hashing.hash and never hashing.rehashLegacy', async () => {
      await service.resetPassword(dto);

      expect(mockHashing.hash).toHaveBeenCalledWith(dto.password);
      expect(mockHashing.rehashLegacy).not.toHaveBeenCalled();
    });

    it('passes the ipAddress into the reset_password audit entry', async () => {
      await service.resetPassword(dto, '203.0.113.9');

      const entry = mockAudit.log.mock.calls.find(c => c[0].action === 'reset_password')?.[0];
      expect(entry?.ipAddress).toBe('203.0.113.9');
    });
  });

  describe('changePassword', () => {
    const dto = {
      currentPassword: 'a senha atual longa',
      newPassword: 'uma senha nova bem comprida',
      newPasswordConfirmation: 'uma senha nova bem comprida',
    };

    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockHashing.hash.mockResolvedValue('$argon2id$new');
      mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });
    });

    it('changes the password when the current one is correct', async () => {
      mockHashing.verify
        .mockResolvedValueOnce({ valid: true, needsRehash: false })  // current
        .mockResolvedValueOnce({ valid: false, needsRehash: false }); // new differs

      await service.changePassword('user-1', dto);

      expect(mockPrisma.user.updateMany.mock.calls[0][0].data.password).toBe('$argon2id$new');
    });

    it('rejects an incorrect current password', async () => {
      mockHashing.verify.mockResolvedValue({ valid: false, needsRehash: false });

      await expect(service.changePassword('user-1', dto)).rejects.toThrow('Senha atual incorreta');
      expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a new password equal to the current one via stored-hash verification', async () => {
      // Plaintext differs, so only hash verification can catch this.
      mockHashing.verify
        .mockResolvedValueOnce({ valid: true, needsRehash: false }) // current ok
        .mockResolvedValueOnce({ valid: true, needsRehash: false }); // new matches stored hash

      await expect(service.changePassword('user-1', dto)).rejects.toThrow(
        'A nova senha deve ser diferente da senha atual',
      );
      expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('verifies the new password against the stored hash, not just the plaintext', async () => {
      mockHashing.verify
        .mockResolvedValueOnce({ valid: true, needsRehash: false })
        .mockResolvedValueOnce({ valid: false, needsRehash: false });

      await service.changePassword('user-1', dto);

      expect(mockHashing.verify).toHaveBeenCalledTimes(2);
      expect(mockHashing.verify).toHaveBeenNthCalledWith(2, '$argon2id$current', dto.newPassword);
    });

    it('rejects the plaintext-identical case early', async () => {
      mockHashing.verify.mockResolvedValueOnce({ valid: true, needsRehash: false });

      await expect(
        service.changePassword('user-1', {
          currentPassword: 'a senha atual longa',
          newPassword: 'a senha atual longa',
          newPasswordConfirmation: 'a senha atual longa',
        }),
      ).rejects.toThrow('A nova senha deve ser diferente da senha atual');
    });

    it('revokes all refresh tokens including the caller session', async () => {
      mockHashing.verify
        .mockResolvedValueOnce({ valid: true, needsRehash: false })
        .mockResolvedValueOnce({ valid: false, needsRehash: false });

      await service.changePassword('user-1', dto);

      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revoked: false },
        data: { revoked: true },
      });
    });

    it.each([
      ['inactive', { ...user, isActive: false }],
      ['unverified', { ...user, emailVerifiedAt: null }],
      ['passwordless', { ...user, password: null }],
    ])('rejects an %s user even with a valid JWT', async (_l, found) => {
      mockPrisma.user.findUnique.mockResolvedValue(found);

      await expect(service.changePassword('user-1', dto)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(mockHashing.verify).not.toHaveBeenCalled();
    });

    it('audits without sensitive data', async () => {
      mockHashing.verify
        .mockResolvedValueOnce({ valid: true, needsRehash: false })
        .mockResolvedValueOnce({ valid: false, needsRehash: false });

      await service.changePassword('user-1', dto);

      const entry = mockAudit.log.mock.calls.find(c => c[0].action === 'change_password')?.[0];
      expect(entry).toBeDefined();
      const serialized = JSON.stringify(entry);
      expect(serialized).not.toContain(dto.newPassword);
      expect(serialized).not.toContain(dto.currentPassword);
      expect(serialized).not.toContain('$argon2id$');
    });

    it('calls hashing.hash and never hashing.rehashLegacy', async () => {
      mockHashing.verify
        .mockResolvedValueOnce({ valid: true, needsRehash: false })
        .mockResolvedValueOnce({ valid: false, needsRehash: false });

      await service.changePassword('user-1', dto);

      expect(mockHashing.hash).toHaveBeenCalledWith(dto.newPassword);
      expect(mockHashing.rehashLegacy).not.toHaveBeenCalled();
    });

    it('passes the ipAddress into the change_password audit entry', async () => {
      mockHashing.verify
        .mockResolvedValueOnce({ valid: true, needsRehash: false })
        .mockResolvedValueOnce({ valid: false, needsRehash: false });

      await service.changePassword('user-1', dto, '203.0.113.9');

      const entry = mockAudit.log.mock.calls.find(c => c[0].action === 'change_password')?.[0];
      expect(entry?.ipAddress).toBe('203.0.113.9');
    });

    it('conditions the write on id, the EXACT hash just verified, and isActive — not id alone', async () => {
      mockHashing.verify
        .mockResolvedValueOnce({ valid: true, needsRehash: false })
        .mockResolvedValueOnce({ valid: false, needsRehash: false });

      await service.changePassword('user-1', dto);

      const where = mockPrisma.user.updateMany.mock.calls[0][0].where;
      expect(where).toEqual({
        id: 'user-1',
        password: user.password,
        isActive: true,
        emailVerifiedAt: { not: null },
      });
    });

    it('when the conditional write matches zero rows, revokes no session and audits no success', async () => {
      mockHashing.verify
        .mockResolvedValueOnce({ valid: true, needsRehash: false })
        .mockResolvedValueOnce({ valid: false, needsRehash: false });
      mockPrisma.user.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.changePassword('user-1', dto)).rejects.toBeInstanceOf(UnauthorizedException);

      expect(mockPrisma.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(mockAudit.log).not.toHaveBeenCalled();
    });

    describe('concurrency (deterministic — controlled by explicit gates, never real elapsed time)', () => {
      /**
       * Models the one column these races are actually about. `updateMany`
       * below re-implements Postgres's own conditional-UPDATE semantics
       * against it: a call only "commits" (mutates `stored`, returns
       * count: 1) if every condition in its `where` still matches `stored`
       * at the moment it runs — exactly the guarantee the real WHERE
       * clause gets from a real row lock, without needing a real database
       * or real concurrent connections to prove the service code honors it.
       */
      function fakeConditionalRow(initial: { password: string; isActive: boolean; emailVerifiedAt: Date | null }) {
        const stored = { ...initial };
        mockPrisma.user.findUnique.mockImplementation(async () => ({ ...user, ...stored }));
        mockPrisma.user.updateMany.mockImplementation(async ({ where, data }: any) => {
          if (where.id !== 'user-1') return { count: 0 };
          if ('password' in where && where.password !== stored.password) return { count: 0 };
          if ('isActive' in where && stored.isActive !== where.isActive) return { count: 0 };
          Object.assign(stored, data);
          return { count: 1 };
        });
        return stored;
      }

      it('a reset that commits WHILE changePassword is still hashing wins — the stale write is rejected, not applied', async () => {
        const stored = fakeConditionalRow({
          password: user.password,
          isActive: true,
          emailVerifiedAt: user.emailVerifiedAt,
        });
        mockHashing.verify
          .mockResolvedValueOnce({ valid: true, needsRehash: false })
          .mockResolvedValueOnce({ valid: false, needsRehash: false });

        const reachedHash = deferred();
        const releaseHash = deferred<string>();
        mockHashing.hash.mockImplementation(async () => {
          reachedHash.resolve();
          return releaseHash.promise;
        });

        const changePromise = service.changePassword('user-1', dto);
        await reachedHash.promise; // changePassword has verified the current password and is now blocked computing the new hash

        // The concurrent reset-password request runs to completion here,
        // committing a password changePassword never saw.
        stored.password = '$argon2id$FROM_RESET';

        releaseHash.resolve('$argon2id$FROM_CHANGE_PASSWORD'); // only now does changePassword's hash resolve
        await expect(changePromise).rejects.toBeInstanceOf(UnauthorizedException);

        expect(stored.password).toBe('$argon2id$FROM_RESET'); // the winner's write stands, untouched
        expect(mockPrisma.refreshToken.updateMany).not.toHaveBeenCalled();
        expect(mockAudit.log).not.toHaveBeenCalled();
      });

      it('a deactivation that commits WHILE changePassword is still hashing wins — the password is not updated', async () => {
        const stored = fakeConditionalRow({
          password: user.password,
          isActive: true,
          emailVerifiedAt: user.emailVerifiedAt,
        });
        mockHashing.verify
          .mockResolvedValueOnce({ valid: true, needsRehash: false })
          .mockResolvedValueOnce({ valid: false, needsRehash: false });

        const reachedHash = deferred();
        const releaseHash = deferred<string>();
        mockHashing.hash.mockImplementation(async () => {
          reachedHash.resolve();
          return releaseHash.promise;
        });

        const changePromise = service.changePassword('user-1', dto);
        await reachedHash.promise;

        // The concurrent admin deactivation commits here.
        stored.isActive = false;

        releaseHash.resolve('$argon2id$new');
        await expect(changePromise).rejects.toBeInstanceOf(UnauthorizedException);

        expect(stored.password).toBe(user.password); // untouched
        expect(mockPrisma.refreshToken.updateMany).not.toHaveBeenCalled();
        expect(mockAudit.log).not.toHaveBeenCalled();
      });

      it('two concurrent changePassword calls against the same original hash — exactly one wins, never both, never neither', async () => {
        const stored = fakeConditionalRow({
          password: user.password,
          isActive: true,
          emailVerifiedAt: user.emailVerifiedAt,
        });
        // Argument-based, not call-order-based: both concurrent requests
        // share this mock, and each independently checks its OWN current
        // password and its OWN new password against the (identical, at
        // this point) stored hash.
        mockHashing.verify.mockImplementation(async (_storedHash: string, plain: string) =>
          plain === dto.currentPassword
            ? { valid: true, needsRehash: false }
            : { valid: false, needsRehash: false },
        );

        const reached = [deferred(), deferred()];
        const release = [deferred<string>(), deferred<string>()];
        let callIndex = 0;
        mockHashing.hash.mockImplementation(async (pw: string) => {
          const i = callIndex++;
          reached[i].resolve();
          await release[i].promise;
          return `$argon2id$for:${pw}`;
        });

        const dtoA = {
          currentPassword: dto.currentPassword,
          newPassword: 'senha concorrente A bem comprida',
          newPasswordConfirmation: 'senha concorrente A bem comprida',
        };
        const dtoB = {
          currentPassword: dto.currentPassword,
          newPassword: 'senha concorrente B bem comprida',
          newPasswordConfirmation: 'senha concorrente B bem comprida',
        };

        const outcomeA = service.changePassword('user-1', dtoA).then(
          () => 'fulfilled' as const,
          () => 'rejected' as const,
        );
        const outcomeB = service.changePassword('user-1', dtoB).then(
          () => 'fulfilled' as const,
          () => 'rejected' as const,
        );

        // Both requests have verified their current password and are now
        // blocked computing their new hash — NEITHER has written yet, so
        // both necessarily read the same original stored password.
        await Promise.all([reached[0].promise, reached[1].promise]);

        release[0].resolve(`$argon2id$for:${dtoA.newPassword}`);
        release[1].resolve(`$argon2id$for:${dtoB.newPassword}`);
        const [resultA, resultB] = await Promise.all([outcomeA, outcomeB]);

        const outcomes = [resultA, resultB];
        expect(outcomes.filter(o => o === 'fulfilled')).toHaveLength(1);
        expect(outcomes.filter(o => o === 'rejected')).toHaveLength(1);

        const winningPassword = resultA === 'fulfilled' ? dtoA.newPassword : dtoB.newPassword;
        expect(stored.password).toBe(`$argon2id$for:${winningPassword}`);
        // Exactly one success is audited and revokes sessions — never two, never zero.
        expect(mockAudit.log.mock.calls.filter(c => c[0].action === 'change_password')).toHaveLength(1);
        expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledTimes(1);
      });
    });
  });
});
