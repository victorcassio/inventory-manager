import { IsString, MaxLength, MinLength } from 'class-validator';
import { IsStrongPassword } from '../../hashing/is-strong-password.validator';
import { IsEqualTo } from '../../hashing/is-equal-to.validator';

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  currentPassword: string;

  @IsStrongPassword()
  newPassword: string;

  @IsString()
  @IsEqualTo('newPassword')
  newPasswordConfirmation: string;
}
