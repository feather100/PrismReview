import { IsOptional, IsString, IsIn, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListUsersQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;

  @IsOptional()
  @IsIn(['super_admin', 'enterprise_admin', 'department_admin', 'user'])
  platformRole?: string;

  @IsOptional()
  @IsIn(['active', 'disabled'])
  status?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
