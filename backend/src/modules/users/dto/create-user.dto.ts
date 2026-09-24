import { IsEmail, IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { UserRole } from '@prisma/client';

/** Roles an admin may assign through this flow. `admin` is deliberately absent. */
export const INVITABLE_ROLES = [UserRole.attendant, UserRole.financial] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsEmail({}, { message: 'E-mail inválido' })
  @MaxLength(150)
  email: string;

  @IsIn(INVITABLE_ROLES, {
    message: 'Perfil inválido. Apenas attendant ou financial podem ser criados',
  })
  role: InvitableRole;
}
