import { IsOptional, IsString, IsIn } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(['super_admin', 'enterprise_admin', 'department_admin', 'user'])
  platformRole?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsIn(['active', 'disabled'])
  status?: string;
}
