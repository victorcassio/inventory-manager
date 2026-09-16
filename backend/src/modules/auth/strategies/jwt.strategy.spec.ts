import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { JwtStrategy } from './jwt.strategy';
import { UsersService } from '../../users/users.service';

const eligible = {
  id: 'user-1',
  name: 'Admin',
  email: 'admin@test.com',
  password: '$argon2id$hash',
  role: UserRole.admin,
  isActive: true,
  emailVerifiedAt: new Date(),
  passwordSetAt: new Date(),
  passwordChangedAt: null,
  lastLogin: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('JwtStrategy', () => {
  const usersService = { findById: jest.fn() } as unknown as UsersService;
  const configService = {
    get: jest.fn().mockReturnValue('access-secret-32-chars-minimum!!'),
  } as unknown as ConfigService;

  const strategy = new JwtStrategy(configService, usersService);

  it('returns the reloaded database row, not the token claims', async () => {
    (usersService.findById as jest.Mock).mockResolvedValue(eligible);
    const result = await strategy.validate({ sub: 'user-1', email: 'stale@test.com', role: 'attendant' });
    expect(result).toEqual(eligible);
    expect(result.role).toBe(UserRole.admin); // DB wins over the stale claim
  });

  it.each([
    ['missing', null],
    ['inactive', { ...eligible, isActive: false }],
    ['unverified', { ...eligible, emailVerifiedAt: null }],
    ['passwordless', { ...eligible, password: null }],
  ])('rejects a %s user', async (_label, found) => {
    (usersService.findById as jest.Mock).mockResolvedValue(found);
    await expect(
      strategy.validate({ sub: 'user-1', email: 'admin@test.com', role: 'admin' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('uses one message for every rejection', async () => {
    (usersService.findById as jest.Mock).mockResolvedValue({ ...eligible, isActive: false });
    await expect(
      strategy.validate({ sub: 'user-1', email: 'admin@test.com', role: 'admin' }),
    ).rejects.toThrow('Usuário não encontrado ou inativo');
  });
});
