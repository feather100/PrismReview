/**
 * human-turn.dto.ts — P4 Human Turn Override（Sprint 5.2 §3.4）
 *
 * POST /reviews/:reviewId/meetings 入参：人类评审员手动注入意见（source='human'）。
 * 用于 HITL 场景中人类覆盖/补充 Moderator 收敛决策。
 */
import { Type } from 'class-transformer';
import {
  IsArray,
  ArrayMinSize,
  IsInt,
  Min,
  IsString,
  IsIn,
  IsOptional,
  ValidateNested,
} from 'class-validator';

export class HumanOpinionDto {
  @IsString()
  dimension: string;

  @IsIn(['high', 'medium', 'low', 'info'])
  riskLevel: string;

  @IsString()
  issue: string;

  @IsString()
  recommendation: string;

  @IsInt()
  @Min(0)
  confidenceScore: number;

  @IsOptional()
  citations?: unknown;
}

export class HumanTurnDto {
  @IsInt()
  @Min(1)
  round: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => HumanOpinionDto)
  opinions: HumanOpinionDto[];
}
