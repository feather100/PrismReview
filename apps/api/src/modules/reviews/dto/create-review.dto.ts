import { IsString, IsOptional, IsEnum } from 'class-validator';

export class CreateReviewDto {
  @IsString() title: string;
  @IsString() objective: string;

  @IsOptional() @IsString() content?: string;

  @IsOptional() @IsEnum(['round_robin', 'free_debate'])
  mode?: string;
}
