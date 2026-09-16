import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UserActionTokensService } from '../user-action-tokens/user-action-tokens.service';
import { InvitationsService } from './invitations.service';
import { UsersService } from './users.service';
import { USER_SELECT } from './user-response.mapper';

const row = {
  id: 'user-1',
  name: 'Maria',
  email: 'maria@test.com',
  role: UserRole.attendant,
  isActive: true,
  emailVerifiedAt: null,
  passwordSetAt: null,
  lastLogin: null,
  createdAt: new Date('2026-09-01'),
  updatedAt: new Date('2026-09-01'),
};

const mockPrisma = {
  user: {
    findMany: jest.fn(),
    count: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  refreshToken: { updateMany: jest.fn() },
  $transaction: jest.fn(),
};
const mockTokens = { findLatest: jest.fn() };
const mockInvitations = { sendInvitation: jest.fn(), revoke: jest.fn() };
const mockAudit = { log: jest.fn() };

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
    mockTokens.findLatest.mockResolvedValue(new Map());

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: UserActionTokensService, useValue: mockTokens },
        { provide: InvitationsService, useValue: mockInvitations },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  describe('findAllPaginated', () => {
    beforeEach(() => {
      mockPrisma.user.findMany.mockResolvedValue([row]);
      mockPrisma.user.count.mockResolvedValue(1);
    });

    it('uses the explicit select and never returns a password', async () => {
      const result = await service.findAllPaginated({});

      expect(mockPrisma.user.findMany.mock.calls[0][0].select).toBe(USER_SELECT);
      expect(result.data[0]).not.toHaveProperty('password');
    });

    it('coerces string page and limit (PaginationDto intersection quirk)', async () => {
      const result = await service.findAllPaginated({ page: '2' as any, limit: '5' as any });

      expect(result.page).toBe(2);
      expect(result.limit).toBe(5);
      expect(mockPrisma.user.findMany.mock.calls[0][0].skip).toBe(5);
      expect(mockPrisma.user.findMany.mock.calls[0][0].take).toBe(5);
    });

    it('searches name and e-mail case-insensitively', async () => {
      await service.findAllPaginated({ search: 'MAR' });

      expect(mockPrisma.user.findMany.mock.calls[0][0].where.OR).toEqual([
        { name: { contains: 'MAR', mode: 'insensitive' } },
        { email: { contains: 'mar', mode: 'insensitive' } },
      ]);
    });

    it('filters by role and status', async () => {
      await service.findAllPaginated({ role: UserRole.financial, status: 'inactive' });

      const where = mockPrisma.user.findMany.mock.calls[0][0].where;
      expect(where.role).toBe(UserRole.financial);
      expect(where.isActive).toBe(false);
    });

    it('lists every role including admin', async () => {
      await service.findAllPaginated({});
      expect(mockPrisma.user.findMany.mock.calls[0][0].where.role).toBeUndefined();
    });

    it('fetches invitation tokens for the whole page in one query', async () => {
      mockPrisma.user.findMany.mockResolvedValue([row, { ...row, id: 'user-2' }]);
      await service.findAllPaginated({});

      expect(mockTokens.findLatest).toHaveBeenCalledTimes(1);
      expect(mockTokens.findLatest.mock.calls[0][0]).toEqual(['user-1', 'user-2']);
    });
  });

  describe('findByIdOrFail', () => {
    it('returns the mapped user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(row);
      const result = await service.findByIdOrFail('user-1');
      expect(result.id).toBe('user-1');
      expect(result).not.toHaveProperty('password');
      expect(mockPrisma.user.findUnique.mock.calls[0][0].select).toBe(USER_SELECT);
    });

    it('throws 404 when missing', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.findByIdOrFail('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create', () => {
    beforeEach(() => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({ ...row, id: 'new-user' });
      mockPrisma.user.findUnique.mockResolvedValue({ ...row, id: 'new-user' });
      mockInvitations.sendInvitation.mockResolvedValue(true);
    });

    it('creates an attendant and reports the invitation as sent', async () => {
      const result = await service.create(
        { name: 'Maria', email: 'maria@test.com', role: UserRole.attendant },
        'admin-1',
      );

      expect(result.invitationEmailSent).toBe(true);
      expect(mockPrisma.user.create.mock.calls[0][0].data).toEqual(
        expect.objectContaining({ role: UserRole.attendant, password: null, isActive: true }),
      );
    });

    it('creates a financial user', async () => {
      await service.create(
        { name: 'João', email: 'joao@test.com', role: UserRole.financial },
        'admin-1',
      );
      expect(mockPrisma.user.create.mock.calls[0][0].data.role).toBe(UserRole.financial);
    });

    it('normalizes the e-mail with trim and lowercase', async () => {
      await service.create(
        { name: 'Maria', email: '  MARIA@Test.COM  ', role: UserRole.attendant },
        'admin-1',
      );
      expect(mockPrisma.user.create.mock.calls[0][0].data.email).toBe('maria@test.com');
    });

    it('rejects a duplicate e-mail case-insensitively with 409', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(row);
      await expect(
        service.create({ name: 'Maria', email: 'MARIA@TEST.COM', role: UserRole.attendant }, 'admin-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('maps a Prisma unique-constraint race to 409', async () => {
      mockPrisma.user.create.mockRejectedValue(
        Object.assign(new Error('unique'), { code: 'P2002' }),
      );
      await expect(
        service.create({ name: 'Maria', email: 'maria@test.com', role: UserRole.attendant }, 'admin-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses to create an admin even if the DTO is bypassed', async () => {
      await expect(
        service.create({ name: 'X', email: 'x@test.com', role: 'admin' as any }, 'admin-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('keeps the user and reports false when delivery fails', async () => {
      mockInvitations.sendInvitation.mockResolvedValue(false);

      const result = await service.create(
        { name: 'Maria', email: 'maria@test.com', role: UserRole.attendant },
        'admin-1',
      );

      expect(result.invitationEmailSent).toBe(false);
      expect(result.user.id).toBe('new-user');
      const actions = mockAudit.log.mock.calls.map(c => c[0].action);
      expect(actions).toContain('invitation_email_failed');
    });

    it('never returns a password and never audits one', async () => {
      const result = await service.create(
        { name: 'Maria', email: 'maria@test.com', role: UserRole.attendant },
        'admin-1',
      );

      expect(result.user).not.toHaveProperty('password');
      expect(JSON.stringify(mockAudit.log.mock.calls)).not.toContain('password');
    });

    it('passes the ipAddress into the create_user audit entry', async () => {
      await service.create(
        { name: 'Maria', email: 'maria@test.com', role: UserRole.attendant },
        'admin-1',
        '203.0.113.9',
      );

      const entry = mockAudit.log.mock.calls.find(c => c[0].action === 'create_user')?.[0];
      expect(entry?.ipAddress).toBe('203.0.113.9');
    });
  });

  describe('update', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue(row);
      mockPrisma.user.update.mockResolvedValue(row);
    });

    it('updates the name', async () => {
      await service.update('user-1', { name: 'Maria Silva' }, 'admin-1');
      expect(mockPrisma.user.update.mock.calls[0][0].data).toEqual({ name: 'Maria Silva' });
    });

    it('revokes refresh tokens when the role changes', async () => {
      await service.update('user-1', { role: UserRole.financial }, 'admin-1');
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revoked: false },
        data: { revoked: true },
      });
    });

    it('does not revoke sessions for a name-only change', async () => {
      await service.update('user-1', { name: 'Maria Silva' }, 'admin-1');
      expect(mockPrisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('refuses to modify an admin target', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...row, role: UserRole.admin });
      await expect(
        service.update('user-1', { name: 'X' }, 'admin-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses a self role change', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...row, id: 'admin-1' });
      await expect(
        service.update('admin-1', { role: UserRole.financial }, 'admin-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws 404 for a missing user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.update('nope', { name: 'X' }, 'admin-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('refuses to assign the admin role even if the DTO is bypassed', async () => {
      await expect(
        service.update('user-1', { role: 'admin' as any }, 'admin-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('passes the ipAddress into the update_user audit entry', async () => {
      await service.update('user-1', { name: 'Maria Silva' }, 'admin-1', '203.0.113.9');

      const entry = mockAudit.log.mock.calls.find(c => c[0].action === 'update_user')?.[0];
      expect(entry?.ipAddress).toBe('203.0.113.9');
    });
  });

  describe('setStatus', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue(row);
      mockPrisma.user.update.mockResolvedValue({ ...row, isActive: false });
    });

    it('deactivates and revokes refresh tokens in the same transaction', async () => {
      await service.setStatus('user-1', false, 'admin-1');

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revoked: false },
        data: { revoked: true },
      });
    });

    it('does not revoke sessions when reactivating', async () => {
      await service.setStatus('user-1', true, 'admin-1');
      expect(mockPrisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('refuses to change the caller own status', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...row, id: 'admin-1' });
      await expect(service.setStatus('admin-1', false, 'admin-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('refuses an admin target', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...row, role: UserRole.admin });
      await expect(service.setStatus('user-1', false, 'admin-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('refuses to deactivate the last active admin', async () => {
      // Guard is reachable only once admin management is enabled; assert it directly.
      // assertNotLastActiveAdmin counts OTHER active admins (id: { not: target.id })
      // and throws when that count is zero — mock 0, not 1, to hit the throw path.
      mockPrisma.user.findUnique.mockResolvedValue({ ...row, role: UserRole.admin });
      mockPrisma.user.count.mockResolvedValue(0);
      await expect(
        (service as any).assertNotLastActiveAdmin({ ...row, role: UserRole.admin }),
      ).rejects.toThrow(/último administrador/);
    });

    it('allows deactivation when another active admin exists', async () => {
      mockPrisma.user.count.mockResolvedValue(1);
      await expect(
        (service as any).assertNotLastActiveAdmin({ ...row, role: UserRole.admin }),
      ).resolves.toBeUndefined();
    });

    it('passes the ipAddress into the update_user_status audit entry', async () => {
      await service.setStatus('user-1', false, 'admin-1', '203.0.113.9');

      const entry = mockAudit.log.mock.calls.find(c => c[0].action === 'update_user_status')?.[0];
      expect(entry?.ipAddress).toBe('203.0.113.9');
    });
  });

  describe('resendInvitation', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue(row);
      mockInvitations.sendInvitation.mockResolvedValue(true);
    });

    it('reissues and reports delivery', async () => {
      const result = await service.resendInvitation('user-1', 'admin-1');
      expect(result.invitationEmailSent).toBe(true);
      expect(mockInvitations.sendInvitation).toHaveBeenCalledWith('user-1');
    });

    it('refuses a user who already activated', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...row, passwordSetAt: new Date() });
      await expect(service.resendInvitation('user-1', 'admin-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('refuses an inactive user and never changes isActive', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...row, isActive: false });

      await expect(service.resendInvitation('user-1', 'admin-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('passes the ipAddress into the resend_user_invitation audit entry', async () => {
      await service.resendInvitation('user-1', 'admin-1', '203.0.113.9');

      const entry = mockAudit.log.mock.calls.find(
        c => c[0].action === 'resend_user_invitation',
      )?.[0];
      expect(entry?.ipAddress).toBe('203.0.113.9');
    });
  });

  describe('revokeInvitation', () => {
    it('delegates to InvitationsService', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(row);
      await service.revokeInvitation('user-1', 'admin-1');
      expect(mockInvitations.revoke).toHaveBeenCalledWith('user-1', 'admin-1', undefined);
    });

    it('forwards the ipAddress to InvitationsService.revoke', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(row);
      await service.revokeInvitation('user-1', 'admin-1', '203.0.113.9');
      expect(mockInvitations.revoke).toHaveBeenCalledWith('user-1', 'admin-1', '203.0.113.9');
    });
  });
});
