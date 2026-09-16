import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { UserRole } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class ListUsersDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  search?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';
}
