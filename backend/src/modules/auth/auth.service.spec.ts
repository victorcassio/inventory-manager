import { Test, TestingModule } from '@nestjs/testing';
import { Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../../prisma/prisma.service';
import { HashingService } from '../hashing/hashing.service';

const mockUser = {
  id: 'user-uuid-1',
  name: 'Admin User',
  email: 'admin@test.com',
  password: '$argon2id$v=19$m=65536,p=1,t=3$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA',
  role: UserRole.admin,
  isActive: true,
  lastLogin: null,
  emailVerifiedAt: new Date('2026-01-01'),
  passwordSetAt: new Date('2026-01-01'),
  passwordChangedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockUsersService = {
  findByEmail: jest.fn(),
  findById: jest.fn(),
};

const mockHashingService = {
  hash: jest.fn(),
  verify: jest.fn(),
  isBcryptHash: jest.fn(),
  verifyDummy: jest.fn().mockResolvedValue(false),
};

const mockPrisma = {
  refreshToken: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  user: {
    update: jest.fn(),
    updateMany: jest.fn(),
  },
};

const mockJwtService = {
  signAsync: jest.fn(),
};

const mockConfigService = {
  get: jest.fn().mockImplementation((key: string) => {
    const cfg: Record<string, string> = {
      'app.jwt.accessSecret': 'access-secret-32-chars-minimum!!',
      'app.jwt.refreshSecret': 'refresh-secret-32-chars-minimum!',
      'app.jwt.accessExpiresIn': '15m',
      'app.jwt.refreshExpiresIn': '7d',
    };
    return cfg[key];
  }),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: HashingService, useValue: mockHashingService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  describe('validateUser', () => {
    it('retorna null quando usuário não existe', async () => {
      mockUsersService.findByEmail.mockResolvedValue(null);
      const result = await service.validateUser('ghost@test.com', 'any');
      expect(result).toBeNull();
    });

    it('retorna null quando usuário está inativo', async () => {
      mockUsersService.findByEmail.mockResolvedValue({ ...mockUser, isActive: false });
      const result = await service.validateUser('admin@test.com', 'any');
      expect(result).toBeNull();
    });

    it('retorna null quando senha está errada', async () => {
      mockUsersService.findByEmail.mockResolvedValue(mockUser);
      mockHashingService.verify.mockResolvedValue({ valid: false, needsRehash: false });
      const result = await service.validateUser('admin@test.com', 'wrong');
      expect(result).toBeNull();
    });

    it('retorna o usuário quando credenciais são válidas', async () => {
      mockUsersService.findByEmail.mockResolvedValue(mockUser);
      mockHashingService.verify.mockResolvedValue({ valid: true, needsRehash: false });
      const result = await service.validateUser('admin@test.com', 'correct');
      expect(result).toEqual(mockUser);
    });
  });

  describe('validateUser — eligibility gate', () => {
    beforeEach(() => {
      mockHashingService.verify.mockResolvedValue({ valid: true, needsRehash: false });
    });

    it('rejects an inactive user', async () => {
      mockUsersService.findByEmail.mockResolvedValue({ ...mockUser, isActive: false });
      await expect(service.validateUser('admin@test.com', 'uma senha bem comprida')).resolves.toBeNull();
    });

    it('rejects a user whose e-mail is not verified', async () => {
      mockUsersService.findByEmail.mockResolvedValue({ ...mockUser, emailVerifiedAt: null });
      await expect(service.validateUser('admin@test.com', 'uma senha bem comprida')).resolves.toBeNull();
    });

    it('rejects a user with no password set', async () => {
      mockUsersService.findByEmail.mockResolvedValue({ ...mockUser, password: null });
      await expect(service.validateUser('admin@test.com', 'uma senha bem comprida')).resolves.toBeNull();
    });

    it('never calls verify() when there is no eligible stored password', async () => {
      mockUsersService.findByEmail.mockResolvedValue({ ...mockUser, password: null });
      await service.validateUser('admin@test.com', 'uma senha bem comprida');
      expect(mockHashingService.verify).not.toHaveBeenCalled();
    });

    it.each([
      ['nonexistent user', null],
      ['inactive user', { ...mockUser, isActive: false }],
      ['unverified user', { ...mockUser, emailVerifiedAt: null }],
      ['passwordless user', { ...mockUser, password: null }],
    ])('runs the dummy verification for a %s', async (_label, found) => {
      mockUsersService.findByEmail.mockResolvedValue(found);
      await service.validateUser('whoever@test.com', 'uma senha bem comprida');
      expect(mockHashingService.verifyDummy).toHaveBeenCalledWith('uma senha bem comprida');
    });

    it('returns null identically for all ineligible conditions — nothing distinguishes them', async () => {
      const results: unknown[] = [];
      for (const found of [null, { ...mockUser, isActive: false }, { ...mockUser, emailVerifiedAt: null }, { ...mockUser, password: null }]) {
        mockUsersService.findByEmail.mockResolvedValue(found);
        results.push(await service.validateUser('whoever@test.com', 'uma senha bem comprida'));
      }
      expect(results).toEqual([null, null, null, null]);
    });
  });

  describe('validateUser — bcrypt migration', () => {
    it('rehashes to Argon2id after a valid bcrypt login', async () => {
      const legacy = { ...mockUser, password: '$2b$12$legacyhashvalue' };
      mockUsersService.findByEmail.mockResolvedValue(legacy);
      mockHashingService.verify.mockResolvedValue({ valid: true, needsRehash: true });
      mockHashingService.hash.mockResolvedValue('$argon2id$v=19$m=65536,p=1,t=3$new$hash');
      mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.validateUser('admin@test.com', 'Admin@123456');

      expect(result).toEqual(legacy);
      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: legacy.id, password: '$2b$12$legacyhashvalue' },
        data: { password: '$argon2id$v=19$m=65536,p=1,t=3$new$hash' },
      });
    });

    it('does not touch passwordChangedAt on a transparent rehash', async () => {
      mockUsersService.findByEmail.mockResolvedValue({ ...mockUser, password: '$2a$12$legacy' });
      mockHashingService.verify.mockResolvedValue({ valid: true, needsRehash: true });
      mockHashingService.hash.mockResolvedValue('$argon2id$new');
      mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });

      await service.validateUser('admin@test.com', 'Admin@123456');

      const data = mockPrisma.user.updateMany.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('passwordChangedAt');
    });

    it('does not rehash an Argon2id password', async () => {
      mockUsersService.findByEmail.mockResolvedValue(mockUser);
      mockHashingService.verify.mockResolvedValue({ valid: true, needsRehash: false });

      await service.validateUser('admin@test.com', 'uma senha bem comprida');

      expect(mockHashingService.hash).not.toHaveBeenCalled();
      expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('does not rehash after an invalid bcrypt login', async () => {
      mockUsersService.findByEmail.mockResolvedValue({ ...mockUser, password: '$2y$12$legacy' });
      mockHashingService.verify.mockResolvedValue({ valid: false, needsRehash: false });

      await expect(service.validateUser('admin@test.com', 'errada')).resolves.toBeNull();
      expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('does not log which algorithm the row used', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      mockUsersService.findByEmail.mockResolvedValue({ ...mockUser, password: '$2b$12$legacy' });
      mockHashingService.verify.mockResolvedValue({ valid: true, needsRehash: true });
      mockHashingService.hash.mockResolvedValue('$argon2id$new');
      mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });

      await service.validateUser('admin@test.com', 'Admin@123456');

      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      logSpy.mockRestore();
      warnSpy.mockRestore();
    });
  });

  describe('login', () => {
    beforeEach(() => {
      mockPrisma.refreshToken.create.mockResolvedValue({});
      mockPrisma.refreshToken.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.user.update.mockResolvedValue({});
    });

    it('retorna access e refresh tokens e dados do usuário', async () => {
      const updatedUser = {
        id: mockUser.id,
        name: mockUser.name,
        email: mockUser.email,
        role: mockUser.role,
        isActive: mockUser.isActive,
        lastLogin: new Date(),
        createdAt: mockUser.createdAt,
        updatedAt: mockUser.updatedAt,
      };
      mockJwtService.signAsync
        .mockResolvedValueOnce('access-token-xyz')
        .mockResolvedValueOnce('refresh-token-xyz');
      mockPrisma.user.update.mockResolvedValue(updatedUser);

      const tokens = await service.login(mockUser as any);

      expect(tokens).toMatchObject({
        accessToken: 'access-token-xyz',
        refreshToken: 'refresh-token-xyz',
        user: expect.objectContaining({ id: mockUser.id, email: mockUser.email }),
      });
    });

    it('salva o refresh token no banco com userId correto', async () => {
      mockJwtService.signAsync
        .mockResolvedValueOnce('at')
        .mockResolvedValueOnce('rt');

      await service.login(mockUser as any);

      expect(mockPrisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: mockUser.id, token: 'rt' }),
        }),
      );
    });

    it('atualiza lastLogin do usuário', async () => {
      mockJwtService.signAsync.mockResolvedValue('token');

      await service.login(mockUser as any);

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockUser.id },
          data: expect.objectContaining({ lastLogin: expect.any(Date) }),
        }),
      );
    });

    it('executa cleanup de tokens revogados e expirados do usuário', async () => {
      mockJwtService.signAsync.mockResolvedValue('token');

      await service.login(mockUser as any);

      expect(mockPrisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: mockUser.id,
          OR: [
            { revoked: true },
            { expiresAt: { lt: expect.any(Date) } },
          ],
        },
      });
    });
  });

  describe('refreshTokens', () => {
    it('lança UnauthorizedException se token não existe', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.refreshTokens('invalid')).rejects.toThrow(UnauthorizedException);
    });

    it('lança UnauthorizedException se token está revogado', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        revoked: true,
        expiresAt: new Date(Date.now() + 100_000),
        user: mockUser,
      });
      await expect(service.refreshTokens('revoked-token')).rejects.toThrow(UnauthorizedException);
    });

    it('lança UnauthorizedException se token está expirado', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        revoked: false,
        expiresAt: new Date(Date.now() - 1000),
        user: mockUser,
      });
      await expect(service.refreshTokens('expired-token')).rejects.toThrow(UnauthorizedException);
    });

    it('revoga o token antigo e emite novos tokens (rotação)', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-old',
        revoked: false,
        expiresAt: new Date(Date.now() + 100_000),
        user: mockUser,
      });
      mockPrisma.refreshToken.update.mockResolvedValue({});
      mockJwtService.signAsync
        .mockResolvedValueOnce('new-access')
        .mockResolvedValueOnce('new-refresh');
      mockPrisma.refreshToken.create.mockResolvedValue({});

      const result = await service.refreshTokens('old-refresh-token');

      expect(mockPrisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-old' },
        data: { revoked: true },
      });
      expect(result).toEqual({ accessToken: 'new-access', refreshToken: 'new-refresh' });
    });
  });

  describe('refreshTokens — user state gate', () => {
    const storedToken = {
      id: 'rt-1',
      token: 'refresh-value',
      revoked: false,
      expiresAt: new Date(Date.now() + 86_400_000),
      user: mockUser,
    };

    it.each([
      ['inactive', { ...mockUser, isActive: false }],
      ['unverified', { ...mockUser, emailVerifiedAt: null }],
      ['passwordless', { ...mockUser, password: null }],
    ])('refuses to rotate for an %s user', async (_label, user) => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({ ...storedToken, user });
      mockPrisma.refreshToken.update.mockResolvedValue({});

      await expect(service.refreshTokens('refresh-value')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('revokes the presented token when the user is ineligible', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        ...storedToken,
        user: { ...mockUser, isActive: false },
      });
      mockPrisma.refreshToken.update.mockResolvedValue({});

      await expect(service.refreshTokens('refresh-value')).rejects.toThrow();
      expect(mockPrisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-1' },
        data: { revoked: true },
      });
    });

    it('keeps the existing generic message', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        ...storedToken,
        user: { ...mockUser, isActive: false },
      });
      mockPrisma.refreshToken.update.mockResolvedValue({});

      await expect(service.refreshTokens('refresh-value')).rejects.toThrow(
        'Token de refresh inválido ou expirado',
      );
    });
  });

  describe('logout', () => {
    it('revoga o refresh token informado', async () => {
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      await service.logout('some-refresh-token');
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { token: 'some-refresh-token', revoked: false },
        data: { revoked: true },
      });
    });

    it('não lança erro se token já estava revogado', async () => {
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.logout('already-revoked')).resolves.not.toThrow();
    });
  });
});
