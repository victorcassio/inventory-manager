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

  describe('passwordChangedAt vs token iat', () => {
    const changedAt = new Date('2026-06-01T12:00:00.000Z');
    const changedUser = { ...eligible, passwordChangedAt: changedAt };

    it('rejects a token issued before the last password change', async () => {
      (usersService.findById as jest.Mock).mockResolvedValue(changedUser);
      const iatBefore = Math.floor(new Date('2026-06-01T11:59:00.000Z').getTime() / 1000);

      await expect(
        strategy.validate({ sub: 'user-1', email: 'admin@test.com', role: 'admin', iat: iatBefore }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('accepts a token issued after the last password change', async () => {
      (usersService.findById as jest.Mock).mockResolvedValue(changedUser);
      const iatAfter = Math.floor(new Date('2026-06-01T12:01:00.000Z').getTime() / 1000);

      await expect(
        strategy.validate({ sub: 'user-1', email: 'admin@test.com', role: 'admin', iat: iatAfter }),
      ).resolves.toEqual(changedUser);
    });

    it('accepts any token for a user with passwordChangedAt null (legacy account)', async () => {
      // The migration deliberately left this column NULL for pre-existing
      // users. Without the null guard in the strategy, every one of them
      // would be locked out instantly regardless of iat.
      (usersService.findById as jest.Mock).mockResolvedValue(eligible);
      const veryOldIat = 0;

      await expect(
        strategy.validate({ sub: 'user-1', email: 'admin@test.com', role: 'admin', iat: veryOldIat }),
      ).resolves.toEqual(eligible);
    });
  });
});
