import { IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AdjustStockDto {
  @IsInt()
  @IsNotEmpty()
  quantity: number;

  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
