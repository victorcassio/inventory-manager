import { ReturnItemCondition } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

class ReturnItemDto {
  @IsUUID()
  @IsNotEmpty()
  rentalItemId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsEnum(ReturnItemCondition)
  condition: ReturnItemCondition;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  damageFee?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateReturnDto {
  @IsOptional()
  @IsDateString()
  returnedAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReturnItemDto)
  items: ReturnItemDto[];
}
