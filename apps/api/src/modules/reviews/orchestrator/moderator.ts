/**
 * moderator.ts — Moderator 契约（Contract §5，P1 mock）
 *
 * P1 用 mock Moderator：按预置规则（轮次计数 + 硬闸）推进，不调真实 LLM。
 * 每条决策落 ModeratorDecision 表（审计），含 ruleCheckResult。
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ReviewState, ModeratorDecisionType, ModeratorDecisionRef } from './graph-runtime';
import type { WorkflowConfig } from '../../workflow/workflow.registry';

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
  // ── P4 (Sprint 5.2) 审计增强（Contract §4.4，可选、向后兼容）──
  readonly proposedTools?: string[]; // Moderator 本轮提议的工具名列表
  readonly toolApprovalReasoning?: string; // 审批工具的理由
  readonly llmRawOutput?: string; // LLM 原始输出（脱敏，仅 providerSource=llm 时填写）
  readonly sanityCheckResult?: { oppositionAllowed: boolean; sanityReason: string };
  // 审计来源标记（'mock' | 'llm' | 'fallback_mock' | 'guard_error'）；仅内存，不落独立列
  readonly providerSource?: string;
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
  decide(state: Readonly<ReviewState>, gates: HardGates, config?: WorkflowConfig): Promise<ModeratorDecision>;
}

/** DI token：env-gated 构造的 Moderator 实现（MockModerator / LlmModerator）。 */
export const MODERATOR_TOKEN = 'MODERATOR_SERVICE';

/**
 * 硬闸计算（代码强制，LLM 不可覆盖）。抽出为共享函数，供 MockModerator 与
 * LlmModerator 复用，确保两条路径的硬闸语义一致（Contract §4.3 硬闸 / §5 红线 #8）。
 */
export function computeRuleCheck(state: Readonly<ReviewState>, gates: HardGates): RuleCheckResult {
  const round = state.round;
  const usage = state.usage;

  const maxRoundsOk = round <= gates.maxRounds;
  const maxTurnsPerReviewerOk = Object.values(usage.turnsByReviewer).every(
    (c) => c <= gates.maxTurnsPerReviewer,
  );
  const maxTokensOk = usage.totalTokens <= gates.maxTokensPerReview;
  const maxCostOk = usage.totalCost <= gates.maxCostPerReview;

  // 收敛启发式（P1 mock 确定性）：各 reviewer 已发言 → 收敛达标
  const reviewersSpoke = Object.keys(usage.turnsByReviewer).length > 0;
  const convergenceOk = reviewersSpoke;

  const passed =
    maxRoundsOk && maxTurnsPerReviewerOk && maxTokensOk && maxCostOk && convergenceOk;

  return {
    maxRoundsOk,
    maxTurnsPerReviewerOk,
    maxTokensOk,
    maxCostOk,
    convergenceOk,
    passed,
  };
}

@Injectable()
export class MockModerator implements Moderator {
  private readonly logger = new Logger(MockModerator.name);

  constructor(private readonly prisma: PrismaService) {}

  async decide(state: Readonly<ReviewState>, gates: HardGates, config?: WorkflowConfig): Promise<ModeratorDecision> {
    const round = state.round;
    const usage = state.usage;

    // ── 硬闸（代码强制，LLM 不可覆盖，复用共享 computeRuleCheck）──
    const ruleCheckResult = computeRuleCheck(state, gates);
    const {
      maxRoundsOk,
      maxTurnsPerReviewerOk,
      maxTokensOk,
      maxCostOk,
      convergenceOk,
      passed,
    } = ruleCheckResult;

    // 9.5b round-2 mock debater（Contract §10）：本轮 high-risk 冲突检测。
    // P1 mock 确定性启发式：本轮 ≥2 条 high-risk opinion → 视为存在未决 high-risk 冲突，
    // 需要进入 round-2 debate 深挖（"存在 riskLevel=high → 的冲突意见 continue_debate"）。
    const conflictCount = await this.detectConflict(state.reviewId, round);
    const conflict = conflictCount >= 2;
    const defenseCount = state.defenseCount ?? 0;

    // 多轮脊柱：默认 converge → completed；冲突则 continue_debate → round-2；到顶则 force_stop。
    let decisionType: ModeratorDecisionType = 'converge';
    let reasoning = `round-${round} summarized: reviewers spoke, no conflict → converge to completed`;

    // @expert mention — if user @mentioned an expert, prioritize asking for defense first
    const mentionedExpert = (state as any).mentionExpertCode;
    const wantDefense = defenseCount < 2 && !conflict && !!mentionedExpert;

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
      // 禁止 converge → 返回 advance_round（9.5b 同样进入 round-2 派发）。
      decisionType = 'advance_round';
      reasoning = `round=${round} < minRounds=${gates.minRounds}: minRounds not met → must continue (advance_round)`;
    } else if (round >= gates.maxRounds) {
      // 9.5b max_rounds 兜底：到顶仍冲突/未决 → 强停（不无限辩论；Contract §5.3）
      decisionType = 'force_stop';
      reasoning = `round=${round} >= maxRounds=${gates.maxRounds}: max rounds reached → force_stop (aborted)`;
    } else if (conflict && (!config || round >= config.debateAfterRound)) {
      // 9.5b round-2 mock debater：存在 high-risk 冲突且已达 debateAfterRound → 继续辩论
      // 向后兼容：未传 config（旧测试）时 !config=true → 保持原有 conflict→continue_debate 行为
      decisionType = 'continue_debate';
      reasoning = `round-${round}: ${conflictCount} high-risk opinions → conflict detected → continue_debate (round-${round + 1} dispatch)`;
    } else if (conflict) {
      // 冲突存在但未达 debateAfterRound：本轮不进 debate（留待后续轮次），按默认 converge/advance 处理
      // F4 警告：high-risk 冲突存在却收敛 —— 明确审计意图（行为被锁定测试 converge + debate deferred）。
      this.logger.warn(
        `Moderator: high-risk conflict detected (${conflictCount} high-risk opinions) ` +
          `at round ${round} < debateAfterRound=${config?.debateAfterRound ?? 'N/A'}; ` +
          `debate deferred — review may converge without debating this conflict`,
      );
      reasoning = `round-${round}: conflict detected but round < debateAfterRound=${config?.debateAfterRound ?? 'N/A'} → debate deferred`;
    } else if (wantDefense) {
      // @expert mentionné → demander à l'utilisateur de défendre / compléter
      decisionType = 'ask_user_defense';
      reasoning = `round-${round}: user @mentioned expert=${mentionedExpert} (direction: "${(state as any).mentionDirection ?? 'n/a'}") → ask_user_defense (defense #${defenseCount + 1})`;
    }

    // 审计落库（§5.4）
    const record = await this.prisma.moderatorDecision.create({
      data: {
        reviewId: state.reviewId,
        round,
        decisionType,
        reasoning,
        ruleCheckResult: ruleCheckResult as unknown as object,
        // P4 审计增强：默认 mock 路径下 proposedTools 空，其余列留 null（向后兼容）
        proposedTools: [],
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

  /**
   * 9.5b 冲突检测（P1 mock 确定性）：读 DB 中本轮（round）所有 turn 的 opinion，
   * 统计 high-risk 条数，作为"未决 high-risk 冲突"的代理信号。
   * 返回 high-risk opinion 数量（≥2 视为冲突）。
   */
  private async detectConflict(reviewId: string, round: number): Promise<number> {
    const turns = await this.prisma.reviewTurn.findMany({
      where: { reviewId, round },
      select: { id: true },
    });
    if (turns.length < 2) return 0;
    const turnIds = turns.map((t) => t.id);
    const opinions = await this.prisma.reviewOpinion.findMany({
      where: { turnId: { in: turnIds } },
      select: { riskLevel: true },
    });
    return opinions.filter((o) => (o.riskLevel || '').toLowerCase() === 'high').length;
  }
}

/** 把决策落库后回读为 state 引用（供 ReviewState.moderatorDecisions 使用）。 */
export function toDecisionRef(d: ModeratorDecision): ModeratorDecisionRef {
  return { decisionId: d.id, round: d.round, decisionType: d.decisionType };
}
