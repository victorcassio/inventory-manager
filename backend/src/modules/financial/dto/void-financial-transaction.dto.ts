import { IsNotEmpty, IsString } from 'class-validator';

export class VoidFinancialTransactionDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}
