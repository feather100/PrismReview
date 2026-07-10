import { IsString, IsOptional, IsInt, Min } from 'class-validator';

export class SearchTestDto {
  @IsString() query: string;

  @IsOptional() @IsInt() @Min(1) topK?: number;
}
