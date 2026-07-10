import { IsString, IsOptional, IsArray } from 'class-validator';

export class CreateRoleDto {
  @IsString() name: string;
  @IsString() code: string;

  @IsOptional() @IsString() departmentId?: string;

  @IsOptional() @IsString() systemPrompt?: string;
  @IsOptional() @IsArray() dimensions?: string[];
  @IsOptional() outputSchema?: any;
}
