import { CustomerDocumentType } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsValidDocument } from '../../../common/validators/document.validator';

class AddressDto {
  @IsString() @IsNotEmpty() street: string;
  @IsString() @IsNotEmpty() number: string;
  @IsString() @IsOptional() complement?: string;
  @IsString() @IsNotEmpty() district: string;
  @IsString() @IsNotEmpty() city: string;
  @IsString() @IsNotEmpty() state: string;
  @IsString() @IsNotEmpty() zipCode: string;
}

export class CreateCustomerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @IsString()
  @IsNotEmpty()
  @IsValidDocument()
  document: string;

  @IsEnum(CustomerDocumentType)
  documentType: CustomerDocumentType;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(150)
  email?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;

  @IsOptional()
  @IsString()
  notes?: string;
}
