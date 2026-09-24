import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { INVITABLE_ROLES, InvitableRole } from './create-user.dto';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsIn(INVITABLE_ROLES, {
    message: 'Perfil inválido. Apenas attendant ou financial podem ser atribuídos',
  })
  role?: InvitableRole;
}
