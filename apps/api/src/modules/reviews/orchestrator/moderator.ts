/**
 * moderator.ts — Moderator 契约（Contract §5，P1 mock）
 *
 * P1 用 mock Moderator：按预置规则（轮次计数 + 硬闸）推进，不调真实 LLM。
 * 每条决策落 ModeratorDecision 表（审计），含 ruleCheckResult。
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ReviewState, ModeratorDecisionType, ModeratorDecisionRef } from './graph-runtime';

export interface RuleCheckResult {
  readonly maxRoundsOk: boolean;
  readonly maxTurnsPerReviewerOk: boolean;
  readonly maxTokensOk: boolean; // P1 恒 true（mock 0 token）
  readonly maxCostOk: boolean; // P1 恒 true（cost=0）
  readonly convergenceOk: boolean; // P1 mock 启发式
  readonly passed: boolean; // 全部 Ok 且未触发强停
}

export interface ModeratorDecision {
  readonly id: string;
  readonly reviewId: string;
  readonly round: number;
  readonly decisionType: ModeratorDecisionType;
  readonly reasoning: string;
  readonly ruleCheckResult: RuleCheckResult;
  readonly createdAt: string;
}

export interface HardGates {
  readonly maxRounds: number;
  readonly maxTurnsPerReviewer: number;
  readonly minRounds: number;
  readonly maxTokensPerReview: number;
  readonly maxCostPerReview: number; // P1 恒为 0（禁用，P2 启用）
}

export const DEFAULT_HARD_GATES: HardGates = {
  maxRounds: 3, // §5.2 轮次上界
  maxTurnsPerReviewer: 3, // 泛化 MODEL_PILOT_MAX_ROLES=3
  minRounds: 1, // §5.2 低于此轮次即使想停也必须继续
  maxTokensPerReview: 200_000, // 仅计数，P1 mock 不触顶
  maxCostPerReview: 0, // P1 禁用，cost 恒 0
};

export interface Moderator {
  decide(state: Readonly<ReviewState>, gates: HardGates): Promise<ModeratorDecision>;
}

@Injectable()
export class MockModerator implements Moderator {
  private readonly logger = new Logger(MockModerator.name);

  constructor(private readonly prisma: PrismaService) {}

  async decide(state: Readonly<ReviewState>, gates: HardGates): Promise<ModeratorDecision> {
    const round = state.round;
    const usage = state.usage;

    // ── 硬闸（代码强制，LLM 不可覆盖）──
    const maxRoundsOk = round <= gates.maxRounds;
    const maxTurnsPerReviewerOk = Object.values(usage.turnsByReviewer).every(
      (c) => c <= gates.maxTurnsPerReviewer,
    );
    const maxTokensOk = usage.totalTokens <= gates.maxTokensPerReview;
    const maxCostOk = usage.totalCost <= gates.maxCostPerReview;

    // 收敛启发式（P1 mock 确定性）：各 reviewer 已发言 → 收敛达标
    const reviewersSpoke = Object.keys(usage.turnsByReviewer).length > 0;
    const convergenceOk = reviewersSpoke;

    const passed = maxRoundsOk && maxTurnsPerReviewerOk && maxTokensOk && maxCostOk && convergenceOk;

    // 单轮脊柱：round-1 summarized 后只做 converge → completed（不触发辩论 / round-2）
    let decisionType: ModeratorDecisionType = 'converge';
    let reasoning = `round-1 summarized: reviewers spoke, single-round spine → converge to completed`;

    // 硬闸强停覆盖（达上限 / 越界 → aborted）
    if (!maxRoundsOk || !maxTokensOk || !maxCostOk) {
      decisionType = 'force_stop';
      reasoning = `hard gate breached (maxRoundsOk=${maxRoundsOk}, maxTokensOk=${maxTokensOk}, maxCostOk=${maxCostOk}) → force_stop (aborted)`;
    } else if (!maxTurnsPerReviewerOk) {
      decisionType = 'force_stop';
      reasoning = `max_turns_per_reviewer breached → force_stop (aborted)`;
    } else if (!convergenceOk) {
      decisionType = 'force_stop';
      reasoning = `convergence not reached (no reviewer spoke) → force_stop (aborted)`;
    } else if (round < gates.minRounds) {
      // P2-2：minRounds 强制校验。未达下限即使想收敛也必须继续，
      // 禁止 converge → 返回 advance_round。9.5a 不实现 round-2 派发，
      // 故脊柱在 handleTurnsComplete 中保持 summarized（9.5b 接管派发 round-2）。
      decisionType = 'advance_round';
      reasoning = `round=${round} < minRounds=${gates.minRounds}: minRounds not met → must continue (advance_round; round-2 dispatch in 9.5b scope)`;
    }

    const ruleCheckResult: RuleCheckResult = {
      maxRoundsOk,
      maxTurnsPerReviewerOk,
      maxTokensOk,
      maxCostOk,
      convergenceOk,
      passed,
    };

    // 审计落库（§5.4）
    const record = await this.prisma.moderatorDecision.create({
      data: {
        reviewId: state.reviewId,
        round,
        decisionType,
        reasoning,
        ruleCheckResult: ruleCheckResult as unknown as object,
      },
    });

    this.logger.log(
      `Moderator decision: review=${state.reviewId.substring(0, 8)} round=${round} type=${decisionType} passed=${passed}`,
    );

    return {
      id: record.id,
      reviewId: state.reviewId,
      round,
      decisionType,
      reasoning,
      ruleCheckResult,
      createdAt: record.createdAt.toISOString(),
    };
  }
}

/** 把决策落库后回读为 state 引用（供 ReviewState.moderatorDecisions 使用）。 */
export function toDecisionRef(d: ModeratorDecision): ModeratorDecisionRef {
  return { decisionId: d.id, round: d.round, decisionType: d.decisionType };
}
