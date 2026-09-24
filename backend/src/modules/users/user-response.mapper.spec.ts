import { UserRole, UserActionTokenType } from '@prisma/client';
import { USER_SELECT, toUserResponse } from './user-response.mapper';

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

const pending = {
  id: 't1',
  userId: 'user-1',
  type: UserActionTokenType.invitation,
  tokenHash: 'a'.repeat(64),
  expiresAt: new Date('2099-01-01'),
  usedAt: null,
  revokedAt: null,
  createdAt: new Date('2026-09-01'),
};

describe('USER_SELECT', () => {
  it('never selects the password', () => {
    expect(USER_SELECT).not.toHaveProperty('password');
  });

  it('selects exactly the public columns', () => {
    expect(Object.keys(USER_SELECT).sort()).toEqual(
      [
        'createdAt',
        'email',
        'emailVerifiedAt',
        'id',
        'isActive',
        'lastLogin',
        'name',
        'passwordSetAt',
        'role',
        'updatedAt',
      ].sort(),
    );
  });
});

describe('toUserResponse', () => {
  it('exposes no password and no tokenHash', () => {
    const response = toUserResponse(row, pending);
    expect(response).not.toHaveProperty('password');
    expect(response).not.toHaveProperty('tokenHash');
    expect(JSON.stringify(response)).not.toContain('a'.repeat(64));
  });

  it('derives the invitation status', () => {
    expect(toUserResponse(row, pending).invitationStatus).toBe('pending');
    expect(toUserResponse(row, undefined).invitationStatus).toBe('none');
  });

  it('exposes invitationExpiresAt only while pending', () => {
    expect(toUserResponse(row, pending).invitationExpiresAt).toEqual(pending.expiresAt);
    expect(toUserResponse(row, { ...pending, revokedAt: new Date() }).invitationExpiresAt).toBeNull();
    expect(toUserResponse({ ...row, passwordSetAt: new Date() }, pending).invitationExpiresAt).toBeNull();
  });
});
