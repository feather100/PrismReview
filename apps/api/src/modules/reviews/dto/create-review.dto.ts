import { IsString, IsOptional, IsEnum } from 'class-validator';

/**
 * CreateReview.mode 枚举（Contract §3.5）：
 *  - 新 workflowId：enterprise | code-review | research | thesis（与 preset ID 对齐）
 *  - 旧 mode 兼容值：round_robin | free_debate（路由到新 preset）
 * 服务端 resolve(mode) 负责映射到具体 preset（round_robin→enterprise，free_debate→code-review）。
 */
export class CreateReviewDto {
  @IsString() title: string;
  @IsString() objective: string;

  @IsOptional() @IsString() content?: string;

  @IsOptional()
  @IsEnum(['enterprise', 'code-review', 'research', 'thesis', 'round_robin', 'free_debate'])
  mode?: string;
}
