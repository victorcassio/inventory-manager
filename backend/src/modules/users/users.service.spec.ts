import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
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
    });

    it('throws 404 when missing', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.findByIdOrFail('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
