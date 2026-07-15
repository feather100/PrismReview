import { IsString, IsOptional, IsArray } from 'class-validator';

export class UpdateRoleDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsArray() dimensions?: string[];
  @IsOptional() @IsString() systemPrompt?: string;
}
