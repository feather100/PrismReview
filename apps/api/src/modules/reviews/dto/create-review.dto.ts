import { IsString, IsOptional, IsEnum, IsObject, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Per-review provider override（产品化）。
 * 不传 → 走全局 env 默认（mock）；传了 → 该 review 用指定 provider 跑真实 LLM。
 * apiKey 仅写入 DB providerConfig，绝不返回给前端、绝不打印日志。
 */
export class ProviderOverrideDto {
  @IsEnum(['mock', 'openai_compatible']) provider: string;

  @IsOptional() @IsString() model?: string;

  @IsOptional() @IsString() baseUrl?: string;

  @IsOptional() @IsString() apiKey?: string;
}

/**
 * CreateReview.mode 枚举（Contract §3.5）：
 *  - 新 workflowId：enterprise | code-review | research | thesis（与 preset ID 对齐）
 *  - 旧 mode 兼容值：round_robin | free_debate（路由到新 preset）
 * 服务端 resolve(mode) 负责映射到具体 preset（round_robin→enterprise，free_debate→code-review）。
 */
export class CreateReviewDto {
  @IsString() title: string;
  @IsString() objective: string;

  @IsOptional() @IsString() content?: string; // 评审材料/方案全文

  @IsOptional()
  @IsEnum(['enterprise', 'code-review', 'research', 'thesis', 'round_robin', 'free_debate'])
  mode?: string;

  // 产品化：每 review 可选覆盖 LLM provider（mock / lmstudio / openai_compatible）
  @IsOptional()
  @ValidateNested()
  @Type(() => ProviderOverrideDto)
  provider?: ProviderOverrideDto;

  // Langue forcée des réponses (zh / en). Facultatif → auto-détection.
  @IsOptional()
  @IsEnum(['zh', 'en'])
  lang?: string;
}
