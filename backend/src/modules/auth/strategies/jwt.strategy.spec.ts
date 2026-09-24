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
    // Deliberately :500ms — not on a whole second — so a test that ever
    // regressed to the old `payload.iat * 1000 < getTime()` comparison
    // (which truncates iat's whole second to :000ms before comparing) would
    // disagree with the millisecond-aware assertions below and fail loudly,
    // instead of the truncation silently cancelling itself out against a
    // changedAt that happens to land on a whole second.
    const changedAt = new Date('2026-06-01T12:00:00.500Z');
    const changedAtSeconds = Math.floor(changedAt.getTime() / 1000); // :00
    const changedUser = { ...eligible, passwordChangedAt: changedAt };

    it('accepts any token for a user with passwordChangedAt null (legacy account)', async () => {
      // The migration deliberately left this column NULL for pre-existing
      // users. Without the null guard in the strategy, every one of them
      // would be locked out instantly regardless of iat.
      (usersService.findById as jest.Mock).mockResolvedValue(eligible);

      await expect(
        strategy.validate({ sub: 'user-1', email: 'admin@test.com', role: 'admin', iat: 0 }),
      ).resolves.toEqual(eligible);
    });

    it('rejects a token issued the second before the change', async () => {
      (usersService.findById as jest.Mock).mockResolvedValue(changedUser);

      await expect(
        strategy.validate({
          sub: 'user-1',
          email: 'admin@test.com',
          role: 'admin',
          iat: changedAtSeconds - 1,
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('accepts a token issued in the SAME civil second as the change', async () => {
      // The bug this guards against: passwordChangedAt is 12:00:00.500Z, so
      // a real login completing at 12:00:00.900Z (900ms later, well inside
      // the same second) mints a token whose iat floors to the identical
      // second, :00. The old `iat * 1000 < getTime()` compared 12:00:00.000
      // against 12:00:00.500 and rejected this genuinely-fresh token —
      // logging the user out immediately after a successful login until the
      // next login happened to land in a later second.
      (usersService.findById as jest.Mock).mockResolvedValue(changedUser);

      await expect(
        strategy.validate({
          sub: 'user-1',
          email: 'admin@test.com',
          role: 'admin',
          iat: changedAtSeconds,
        }),
      ).resolves.toEqual(changedUser);
    });

    it('accepts a token issued the second after the change', async () => {
      (usersService.findById as jest.Mock).mockResolvedValue(changedUser);

      await expect(
        strategy.validate({
          sub: 'user-1',
          email: 'admin@test.com',
          role: 'admin',
          iat: changedAtSeconds + 1,
        }),
      ).resolves.toEqual(changedUser);
    });

    it('rejects a token with no iat at all, once passwordChangedAt is set', async () => {
      // Every token this app signs carries an iat (AuthService never passes
      // `noTimestamp`); passport-jwt does not itself require or validate
      // one. A payload missing it did not come from here and must not be
      // trusted by default just because the comparison below it has nothing
      // to compare against.
      (usersService.findById as jest.Mock).mockResolvedValue(changedUser);

      await expect(
        strategy.validate({ sub: 'user-1', email: 'admin@test.com', role: 'admin' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    // Mutation-style check: this fails if `<` in the strategy is ever
    // swapped for `<=` (which would start rejecting the same-civil-second
    // case the test above requires to pass), pinning down that strict
    // less-than — and only strict less-than — is what rejects.
    it('the boundary is strict: iat one second before is rejected, iat exactly at the boundary is not', async () => {
      (usersService.findById as jest.Mock).mockResolvedValue(changedUser);

      const before = strategy.validate({
        sub: 'user-1',
        email: 'admin@test.com',
        role: 'admin',
        iat: changedAtSeconds - 1,
      });
      const atBoundary = strategy.validate({
        sub: 'user-1',
        email: 'admin@test.com',
        role: 'admin',
        iat: changedAtSeconds,
      });

      await expect(before).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(atBoundary).resolves.toEqual(changedUser);
    });
  });
});
