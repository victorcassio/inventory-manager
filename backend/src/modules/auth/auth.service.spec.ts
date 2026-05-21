import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UserRole } from '@prisma/client';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockUser = {
  id: 'user-uuid-1',
  name: 'Admin User',
  email: 'admin@test.com',
  password: 'hashed-password',
  role: UserRole.admin,
  isActive: true,
  lastLogin: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockUsersService = {
  findByEmail: jest.fn(),
  findById: jest.fn(),
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
      jest.spyOn(bcrypt, 'compare').mockImplementation(async () => false);
      const result = await service.validateUser('admin@test.com', 'wrong');
      expect(result).toBeNull();
    });

    it('retorna o usuário quando credenciais são válidas', async () => {
      mockUsersService.findByEmail.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockImplementation(async () => true);
      const result = await service.validateUser('admin@test.com', 'correct');
      expect(result).toEqual(mockUser);
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
