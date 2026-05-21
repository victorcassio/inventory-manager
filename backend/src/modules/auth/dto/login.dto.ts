import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';

const GENERIC = { message: 'Credenciais inválidas' };

export class LoginDto {
  @IsEmail({}, GENERIC)
  email: string;

  @IsString(GENERIC)
  @MinLength(1, GENERIC)
  @MaxLength(200, GENERIC)
  password: string;
}
