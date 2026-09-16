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
  user: { findUnique: jest.fn(), update: jest.fn() },
  refreshToken: { updateMany: jest.fn() },
  $transaction: jest.fn(),
};
const mockTokens = {
  issue: jest.fn(),
  consume: jest.fn(),
  revokePending: jest.fn(),
  countRecent: jest.fn(),
};
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
      mockPrisma.user.update.mockResolvedValue(user);
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });
    });

    it('writes the new hash and stamps passwordChangedAt', async () => {
      await service.resetPassword(dto);

      const data = mockPrisma.user.update.mock.calls[0][0].data;
      expect(data.password).toBe('$argon2id$new');
      expect(data.passwordChangedAt).toBeInstanceOf(Date);
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
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
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
      mockPrisma.user.update.mockResolvedValue(user);
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });
    });

    it('changes the password when the current one is correct', async () => {
      mockHashing.verify
        .mockResolvedValueOnce({ valid: true, needsRehash: false })  // current
        .mockResolvedValueOnce({ valid: false, needsRehash: false }); // new differs

      await service.changePassword('user-1', dto);

      expect(mockPrisma.user.update.mock.calls[0][0].data.password).toBe('$argon2id$new');
    });

    it('rejects an incorrect current password', async () => {
      mockHashing.verify.mockResolvedValue({ valid: false, needsRehash: false });

      await expect(service.changePassword('user-1', dto)).rejects.toThrow('Senha atual incorreta');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects a new password equal to the current one via stored-hash verification', async () => {
      // Plaintext differs, so only hash verification can catch this.
      mockHashing.verify
        .mockResolvedValueOnce({ valid: true, needsRehash: false }) // current ok
        .mockResolvedValueOnce({ valid: true, needsRehash: false }); // new matches stored hash

      await expect(service.changePassword('user-1', dto)).rejects.toThrow(
        'A nova senha deve ser diferente da senha atual',
      );
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
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
  });
});
