import { Prisma, UserRole } from '@prisma/client';
import { deriveInvitationStatus, InvitationStatus } from './invitations.service';
import { LatestActionToken } from '../user-action-tokens/user-action-tokens.service';

/**
 * The only shape in which a user leaves this module. Declared as a Prisma
 * select so `password` cannot be picked up by accident when a column is added.
 */
export const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  emailVerifiedAt: true,
  passwordSetAt: true,
  lastLogin: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export type SelectedUser = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

export interface UserResponse {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  emailVerifiedAt: Date | null;
  passwordSetAt: Date | null;
  lastLogin: Date | null;
  createdAt: Date;
  updatedAt: Date;
  invitationStatus: InvitationStatus;
  /** Only set while the invitation is pending. */
  invitationExpiresAt: Date | null;
}

export function toUserResponse(
  user: SelectedUser,
  latestInvitation?: LatestActionToken,
  now: Date = new Date(),
): UserResponse {
  const invitationStatus = deriveInvitationStatus(user, latestInvitation, now);

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    emailVerifiedAt: user.emailVerifiedAt,
    passwordSetAt: user.passwordSetAt,
    lastLogin: user.lastLogin,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    invitationStatus,
    invitationExpiresAt:
      invitationStatus === 'pending' ? (latestInvitation?.expiresAt ?? null) : null,
  };
}
