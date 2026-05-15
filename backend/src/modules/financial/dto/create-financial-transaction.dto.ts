import {
  FinancialTransactionCategory,
  FinancialTransactionType,
} from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateFinancialTransactionDto {
  @IsEnum(FinancialTransactionType)
  type: FinancialTransactionType;

  @IsEnum(FinancialTransactionCategory)
  category: FinancialTransactionCategory;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsDateString()
  transactionDate: string;

  @IsOptional()
  @IsUUID()
  rentalId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
