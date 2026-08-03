import { IsString, IsOptional, IsEnum, IsUUID } from 'class-validator';

/**
 * CreateReviewDto — Sprint 10.1: only accept llmProviderId reference.
 * Plaintext apiKey path REMOVED — Review no longer stores provider config.
 * Provider selection is by reference to a tenant-scoped LlmProvider record.
 */
export class CreateReviewDto {
  @IsString() title: string;
  @IsString() objective: string;

  @IsOptional() @IsString() content?: string; // 评审材料/方案全文

  @IsOptional()
  @IsEnum(['enterprise', 'code-review', 'research', 'thesis', 'round_robin', 'free_debate'])
  mode?: string;

  // Sprint 10.1: Reference to a tenant-scoped LlmProvider (validated at service layer)
  @IsOptional() @IsUUID('4') llmProviderId?: string;

  // Langue forcée des réponses (zh / en). Facultatif → auto-détection.
  @IsOptional()
  @IsEnum(['zh', 'en'])
  lang?: string;
}
