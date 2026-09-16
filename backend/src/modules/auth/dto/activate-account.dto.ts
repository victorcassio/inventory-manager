import { IsString, MaxLength, MinLength } from 'class-validator';
import { IsStrongPassword } from '../../hashing/is-strong-password.validator';
import { IsEqualTo } from '../../hashing/is-equal-to.validator';

export class ActivateAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  token: string;

  @IsStrongPassword()
  password: string;

  @IsString()
  @IsEqualTo('password')
  passwordConfirmation: string;
}
