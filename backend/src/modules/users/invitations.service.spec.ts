import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserActionTokenType, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { HashingService } from '../hashing/hashing.service';
import { UserActionTokensService } from '../user-action-tokens/user-action-tokens.service';
import { MAIL_SERVICE } from '../mail/mail.service';
import { InvitationsService, deriveInvitationStatus } from './invitations.service';

const NOW = new Date('2026-09-15T12:00:00Z');

function token(overrides: Partial<any> = {}) {
  return {
    id: 't1',
    userId: 'user-1',
    type: UserActionTokenType.invitation,
    tokenHash: 'a'.repeat(64),
    expiresAt: new Date('2026-09-16T12:00:00Z'),
    usedAt: null,
    revokedAt: null,
    createdAt: new Date('2026-09-15T11:00:00Z'),
    ...overrides,
  };
}

describe('deriveInvitationStatus', () => {
  it('returns accepted when the password is set, whatever the tokens say', () => {
    expect(
      deriveInvitationStatus({ passwordSetAt: NOW }, token({ revokedAt: NOW }), NOW),
    ).toBe('accepted');
  });

  it('returns pending for a live token', () => {
    expect(deriveInvitationStatus({ passwordSetAt: null }, token(), NOW)).toBe('pending');
  });

  it('returns none when there is no token at all', () => {
    expect(deriveInvitationStatus({ passwordSetAt: null }, undefined, NOW)).toBe('none');
  });

  it('returns revoked when the newest token was revoked', () => {
    expect(
      deriveInvitationStatus({ passwordSetAt: null }, token({ revokedAt: NOW }), NOW),
    ).toBe('revoked');
  });

  it('returns expired when the newest token just aged out', () => {
    expect(
      deriveInvitationStatus(
        { passwordSetAt: null },
        token({ expiresAt: new Date('2026-09-14T12:00:00Z') }),
        NOW,
      ),
    ).toBe('expired');
  });

  it('returns expired for a used-but-not-activated token', () => {
    // Defensive: usedAt set without passwordSetAt should never be reachable,
    // but it must not read as pending.
    expect(
      deriveInvitationStatus({ passwordSetAt: null }, token({ usedAt: NOW }), NOW),
    ).toBe('expired');
  });
});

const user = {
  id: 'user-1',
  name: 'Maria',
  email: 'maria@test.com',
  password: null,
  role: UserRole.attendant,
  isActive: true,
  emailVerifiedAt: null,
  passwordSetAt: null,
  passwordChangedAt: null,
  lastLogin: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const mockPrisma = {
  user: { findUnique: jest.fn(), updateMany: jest.fn() },
  $transaction: jest.fn(),
};
const mockTokens = {
  issue: jest.fn(),
  consume: jest.fn(),
  revokePending: jest.fn(),
  findLatest: jest.fn(),
  looksValid: jest.fn(),
};
const mockHashing = { hash: jest.fn() };
const mockMail = { send: jest.fn() };
const mockAudit = { log: jest.fn() };
const mockConfig = {
  get: jest.fn().mockImplementation((k: string) =>
    k === 'app.frontendUrl' ? 'http://localhost:5173' : undefined,
  ),
};

describe('InvitationsService', () => {
  let service: InvitationsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
    mockTokens.issue.mockResolvedValue('RAW_INVITE_TOKEN');
    mockTokens.revokePending.mockResolvedValue(0);
    mockTokens.looksValid.mockResolvedValue(true);
    mockPrisma.user.findUnique.mockResolvedValue(user);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvitationsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: UserActionTokensService, useValue: mockTokens },
        { provide: HashingService, useValue: mockHashing },
        { provide: MAIL_SERVICE, useValue: mockMail },
        { provide: AuditService, useValue: mockAudit },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get(InvitationsService);
  });

  describe('sendInvitation', () => {
    it('revokes pending invitations before issuing a new one', async () => {
      await service.sendInvitation('user-1');
      expect(mockTokens.revokePending).toHaveBeenCalledWith(
        'user-1',
        UserActionTokenType.invitation,
        expect.anything(),
      );
    });

    it('builds the activation link with the token in the fragment', async () => {
      await service.sendInvitation('user-1');
      const sent = mockMail.send.mock.calls[0][0];
      expect(sent.text).toContain('http://localhost:5173/activate-account#token=RAW_INVITE_TOKEN');
      expect(sent.text).not.toContain('?token=');
    });

    it('resolves true when the mail is accepted', async () => {
      mockMail.send.mockResolvedValue(undefined);
      await expect(service.sendInvitation('user-1')).resolves.toBe(true);
    });

    it('resolves false instead of throwing when delivery fails', async () => {
      mockMail.send.mockRejectedValue(new Error('SMTP down'));
      await expect(service.sendInvitation('user-1')).resolves.toBe(false);
    });

    it('keeps the issued token when delivery fails, so a resend works', async () => {
      mockMail.send.mockRejectedValue(new Error('SMTP down'));
      await service.sendInvitation('user-1');
      expect(mockTokens.issue).toHaveBeenCalledTimes(1);
    });

    it('logs a delivery failure without the token or the URL', async () => {
      mockMail.send.mockRejectedValue(new Error('SMTP down'));
      const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await service.sendInvitation('user-1');

      const logged = spy.mock.calls.map(c => String(c[0])).join(' ');
      expect(logged).not.toContain('RAW_INVITE_TOKEN');
      expect(logged).not.toContain('activate-account');
      spy.mockRestore();
    });
  });

  describe('activate', () => {
    const dto = {
      token: 'RAW_INVITE_TOKEN',
      password: 'uma senha bem comprida',
      passwordConfirmation: 'uma senha bem comprida',
    };

    beforeEach(() => {
      mockTokens.consume.mockResolvedValue({ userId: 'user-1' });
      mockHashing.hash.mockResolvedValue('$argon2id$new');
      mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });
    });

    it('sets the password and both verification timestamps', async () => {
      await service.activate(dto);

      const call = mockPrisma.user.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'user-1', isActive: true });
      expect(call.data.password).toBe('$argon2id$new');
      expect(call.data.emailVerifiedAt).toBeInstanceOf(Date);
      expect(call.data.passwordSetAt).toBeInstanceOf(Date);
    });

    it('runs in a single transaction', async () => {
      await service.activate(dto);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('revokes the user other pending invitations', async () => {
      await service.activate(dto);
      expect(mockTokens.revokePending).toHaveBeenCalledWith(
        'user-1',
        UserActionTokenType.invitation,
        expect.anything(),
      );
    });

    it('issues no session — activation never authenticates', async () => {
      const result = await service.activate(dto);
      expect(result).toBeUndefined();
    });

    it.each([
      ['expired', 'Link inválido ou expirado'],
      ['used', 'Link inválido ou expirado'],
      ['revoked', 'Link inválido ou expirado'],
    ])('rejects a %s token with the generic message', async (_label, message) => {
      mockTokens.consume.mockRejectedValue(new BadRequestException(message));

      await expect(service.activate(dto)).rejects.toThrow('Link inválido ou expirado');
      expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('rejects with the generic message, before hashing, when the preflight finds the token invalid', async () => {
      mockTokens.looksValid.mockResolvedValue(false);

      await expect(service.activate(dto)).rejects.toThrow('Link inválido ou expirado');
      expect(mockHashing.hash).not.toHaveBeenCalled();
      expect(mockTokens.consume).not.toHaveBeenCalled();
      expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
      expect(mockAudit.log).not.toHaveBeenCalled();
    });

    it('calls hashing.hash exactly once for a token that passes the preflight', async () => {
      await service.activate(dto);
      expect(mockHashing.hash).toHaveBeenCalledTimes(1);
      expect(mockHashing.hash).toHaveBeenCalledWith(dto.password);
    });

    it('runs the preflight against the invitation type', async () => {
      await service.activate(dto);
      expect(mockTokens.looksValid).toHaveBeenCalledWith(dto.token, UserActionTokenType.invitation);
    });

    it('does not set the password when the account is no longer active, even though consume() accepted the token', async () => {
      // Simulates the race: the preflight and consume() both saw a live
      // token (nothing here says otherwise), but the account itself was
      // deactivated by the time the conditional write runs. This is the
      // defense-in-depth check, isolated from token revocation — consume()
      // succeeding is exactly what makes this NOT the "token already
      // revoked" path.
      mockPrisma.user.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.activate(dto)).rejects.toThrow('Link inválido ou expirado');

      expect(mockTokens.consume).toHaveBeenCalled(); // the token WAS consumed...
      expect(mockTokens.revokePending).not.toHaveBeenCalled(); // ...but nothing after the guard ran
      expect(mockAudit.log).not.toHaveBeenCalled();
    });

    it('rejects with the same generic message whether the token or the account state is the defect', async () => {
      mockPrisma.user.updateMany.mockResolvedValue({ count: 0 });
      const fromAccountState = await service.activate(dto).catch((e: Error) => e.message);

      mockTokens.consume.mockRejectedValue(new BadRequestException('Link inválido ou expirado'));
      const fromBadToken = await service.activate(dto).catch((e: Error) => e.message);

      expect(fromAccountState).toBe(fromBadToken);
    });

    it('never exposes the password in the audit payload', async () => {
      await service.activate(dto);

      const entry = mockAudit.log.mock.calls.find(c => c[0].action === 'activate_account')?.[0];
      expect(entry).toBeDefined();
      expect(JSON.stringify(entry)).not.toContain('uma senha bem comprida');
      expect(JSON.stringify(entry)).not.toContain('RAW_INVITE_TOKEN');
    });
  });

  describe('revoke', () => {
    it('revokes pending invitations and audits', async () => {
      mockTokens.revokePending.mockResolvedValue(1);

      await service.revoke('user-1', 'admin-1');

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'admin-1',
          action: 'revoke_user_invitation',
          entity: 'User',
          entityId: 'user-1',
        }),
        expect.anything(),
      );
    });

    it('throws 404 when there is nothing pending to revoke', async () => {
      mockTokens.revokePending.mockResolvedValue(0);
      await expect(service.revoke('user-1', 'admin-1')).rejects.toThrow(
        'Nenhum convite pendente para este usuário',
      );
    });

    it('passes the ipAddress into the revoke_user_invitation audit entry', async () => {
      mockTokens.revokePending.mockResolvedValue(1);

      await service.revoke('user-1', 'admin-1', '203.0.113.9');

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'revoke_user_invitation',
          ipAddress: '203.0.113.9',
        }),
        expect.anything(),
      );
    });
  });
});
