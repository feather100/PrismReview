import { IsEmail, IsString, IsIn, IsOptional } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  name: string;

  @IsIn(['super_admin', 'enterprise_admin', 'department_admin', 'user'])
  platformRole: string;

  @IsOptional()
  @IsString()
  departmentId?: string;
}
