/**
 * moderator.ts — Moderator 契约（Contract §5，P1 mock）
 *
 * P1 用 mock Moderator：按预置规则（轮次计数 + 硬闸）推进，不调真实 LLM。
 * 每条决策落 ModeratorDecision 表（审计），含 ruleCheckResult。
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { isReportable } from './opinion-lifecycle';
import { ReviewState, ModeratorDecisionType, ModeratorDecisionRef } from './graph-runtime';
import type { WorkflowConfig } from '../../workflow/workflow.registry';

export interface RuleCheckResult {
  readonly maxRoundsOk: boolean;
  readonly maxTurnsPerReviewerOk: boolean;
  readonly maxTokensOk: boolean; // P1 恒 true（mock 0 token）
  readonly maxCostOk: boolean; // P1 恒 true（cost=0）
  readonly convergenceOk: boolean; // P1 mock 启发式
  readonly allAgreeOk: boolean; // T2：全员 AGREE 信号（本轮所有意见 stance=agree）
  readonly noNewArgumentsOk: boolean; // T2：无新论点信号（LLM 判定 / mock dedup 代理）
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

/** T2 (Sprint 11.0) 收敛信号：Moderator 终止条件三选一（全员 AGREE / no-new-arguments / maxRounds 硬闸）。 */
export interface ConvergenceSignals {
  readonly allAgree?: boolean; // 全员 AGREE：本轮所有意见 stance === 'agree'
  readonly noNewArguments?: boolean; // 本轮无新论点（LLM 判定 / mock dedup 代理）
}

/** T7：可升级辩论 —— 面板扩容上限（1 = 扩容一次后仍未收敛 → 转人工） */
export const ESCALATE_MAX = 1;

/** T8：风险门阈值 —— riskLevel=high 且有效置信度(score??confidence) < 60 → 必过人工门 */
export const RISK_GATE_MIN_CONFIDENCE = 60;

/**
 * T8：统计"高风险且低置信度"的 reportable 意见数（>0 → 人工门必过）。
 * 有效置信度 = score（ScoringPass）?? reviewer confidenceScore ?? 0。
 */
export async function countRiskGateFindings(
  prisma: PrismaService,
  reviewId: string,
  minConfidence = RISK_GATE_MIN_CONFIDENCE,
): Promise<number> {
  const opinions = await prisma.reviewOpinion.findMany({
    where: { reviewId },
    select: { riskLevel: true, confidenceScore: true, score: true, status: true },
  });
  return opinions.filter((o) => {
    if (!isReportable(o.status)) return false;
    if ((o.riskLevel || '').toLowerCase() !== 'high') return false;
    const eff =
      typeof o.score === 'number'
        ? o.score
        : typeof o.confidenceScore === 'number'
          ? o.confidenceScore
          : 0;
    return eff < minConfidence;
  }).length;
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
export function computeRuleCheck(
  state: Readonly<ReviewState>,
  gates: HardGates,
  signals?: ConvergenceSignals,
): RuleCheckResult {
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

  // T2：round≥2 且传入信号 → 显式收敛判定（全员 AGREE 或 no-new-arguments）；
  // 否则（round-1 / 旧调用方不传信号）保留「已发言」启发式，向后兼容。
  const allAgreeOk = signals?.allAgree === true;
  const noNewArgumentsOk = signals?.noNewArguments === true;
  const useSignals = !!signals && round >= 2;
  const convergenceOk = useSignals ? allAgreeOk || noNewArgumentsOk : reviewersSpoke;

  const passed =
    maxRoundsOk && maxTurnsPerReviewerOk && maxTokensOk && maxCostOk && convergenceOk;

  return {
    maxRoundsOk,
    maxTurnsPerReviewerOk,
    maxTokensOk,
    maxCostOk,
    allAgreeOk,
    noNewArgumentsOk,
    convergenceOk,
    passed,
  };
}

/**
 * T2：加载一轮评审的证据与收敛信号（Mock 与 LLM 共享，避免两条路径语义漂移）。
 * - highRiskCount：本轮 high-risk 意见数（冲突代理，沿用 9.5b）
 * - allAgree：本轮所有意见 stance === 'agree'（全员 AGREE 收敛信号）
 * - noNewArguments：本轮所有非空 dedupKey 均已在更早轮次出现（T1 内容键去重的副产品，
 *   作为 mock 确定性「无新论点」代理；空键一律视为有新论点，保守不收敛）
 */
export async function loadRoundEvidence(
  prisma: PrismaService,
  reviewId: string,
  round: number,
): Promise<{ highRiskCount: number; allAgree: boolean; noNewArguments: boolean }> {
  const turns = await prisma.reviewTurn.findMany({
    where: { reviewId, round },
    select: { id: true },
  });
  const turnIds = turns.map((t) => t.id);
  if (turnIds.length === 0) return { highRiskCount: 0, allAgree: false, noNewArguments: false };

  const opinions = await prisma.reviewOpinion.findMany({
    where: { turnId: { in: turnIds } },
    select: { riskLevel: true, stance: true, dedupKey: true },
  });
  if (opinions.length === 0) return { highRiskCount: 0, allAgree: false, noNewArguments: false };

  const highRiskCount = opinions.filter(
    (o) => (o.riskLevel || '').toLowerCase() === 'high',
  ).length;
  const allAgree = opinions.every((o) => (o.stance ?? 'neutral') === 'agree');

  // noNewArguments：本轮全部非空 dedupKey ⊆ 更早轮次 dedupKey 集合
  const thisKeys = opinions
    .map((o) => o.dedupKey)
    .filter((k): k is string => !!k && k.length > 0);
  if (thisKeys.length === 0) return { highRiskCount, allAgree, noNewArguments: false };

  const prevTurns = await prisma.reviewTurn.findMany({
    where: { reviewId, round: { lt: round } },
    select: { id: true },
  });
  const prevTurnIds = prevTurns.map((t) => t.id);
  let noNewArguments = false;
  if (prevTurnIds.length > 0) {
    const prevOpinions = await prisma.reviewOpinion.findMany({
      where: { turnId: { in: prevTurnIds } },
      select: { dedupKey: true },
    });
    const prevKeys = new Set(
      prevOpinions.map((p) => p.dedupKey).filter((k): k is string => !!k && k.length > 0),
    );
    noNewArguments = thisKeys.every((k) => prevKeys.has(k));
  }
  return { highRiskCount, allAgree, noNewArguments };
}

@Injectable()
export class MockModerator implements Moderator {
  private readonly logger = new Logger(MockModerator.name);

  constructor(
    private readonly prisma: PrismaService,
    // T6：成本超限审计（可选，手动 new 时 undefined）
    private readonly audit?: AuditService,
  ) {}

  async decide(state: Readonly<ReviewState>, gates: HardGates, config?: WorkflowConfig): Promise<ModeratorDecision> {
    const round = state.round;
    const usage = state.usage;

    // ── 硬闸 + T2 收敛信号（代码强制，LLM 不可覆盖，复用共享 computeRuleCheck）──
    // T2：round≥2 加载辩论证据（冲突计数 + 全员 AGREE + no-new-arguments 信号）。
    const evidence = await loadRoundEvidence(this.prisma, state.reviewId, round);
    const conflictCount = evidence.highRiskCount;
    const conflict = conflictCount >= 2;
    const signals: ConvergenceSignals | undefined =
      round >= 2
        ? { allAgree: evidence.allAgree, noNewArguments: evidence.noNewArguments }
        : undefined;
    const ruleCheckResult = computeRuleCheck(state, gates, signals);
    const {
      maxRoundsOk,
      maxTurnsPerReviewerOk,
      maxTokensOk,
      maxCostOk,
      convergenceOk,
      allAgreeOk,
      noNewArgumentsOk,
      passed,
    } = ruleCheckResult;

    const defenseCount = state.defenseCount ?? 0;
    // T8：风险分级 HITL —— 高风险低置信度意见计数（>0 → 人工门必过）
    const riskGateCount = await countRiskGateFindings(this.prisma, state.reviewId);
    const riskGateRequired = riskGateCount > 0;

    // 多轮脊柱：默认 converge → completed；冲突则 continue_debate → round-2；到顶则 force_stop。
    let decisionType: ModeratorDecisionType = 'converge';
    let reasoning = `round-${round} summarized: reviewers spoke, no conflict → converge to completed`;

    // @expert mention — if user @mentioned an expert, prioritize asking for defense first
    const mentionedExpert = (state as any).mentionExpertCode;
    const wantDefense = defenseCount < 2 && !conflict && !!mentionedExpert;

    // 硬闸强停覆盖（达上限 / 越界 → aborted）
    const costCapEnabled = Number.isFinite(gates.maxCostPerReview) && gates.maxCostPerReview > 0;
    if (!maxRoundsOk || !maxTokensOk || !maxTurnsPerReviewerOk) {
      decisionType = 'force_stop';
      reasoning = `hard gate breached (maxRoundsOk=${maxRoundsOk}, maxTokensOk=${maxTokensOk}, maxTurnsPerReviewerOk=${maxTurnsPerReviewerOk}) → force_stop (aborted)`;
    } else if (costCapEnabled && !maxCostOk) {
      // T6：成本超限 → 强制收敛（进入评分阶段产出报告），不 abort；审计成本事件
      decisionType = 'converge';
      reasoning = `cost cap reached ($${usage.totalCost.toFixed(4)} > $${gates.maxCostPerReview}) → forced converge (scoring pass)`;
      void this.audit
        ?.log({
          tenantId: '00000000-0000-0000-0000-000000000000',
          action: 'review.cost_cap_reached',
          resource: 'review',
          resourceId: state.reviewId,
          detail: { reviewId: state.reviewId, totalCost: usage.totalCost, cap: gates.maxCostPerReview },
        })
        .catch(() => {});
    } else if (round === 1 && !convergenceOk) {
      decisionType = 'force_stop';
      reasoning = `round-1 convergence not reached (no reviewer spoke) → force_stop (aborted)`;
    } else if (round < gates.minRounds) {
      // P2-2：minRounds 强制校验。未达下限即使想收敛也必须继续，
      // 禁止 converge → 返回 advance_round（9.5b 同样进入 round-2 派发）。
      decisionType = 'advance_round';
      reasoning = `round=${round} < minRounds=${gates.minRounds}: minRounds not met → must continue (advance_round)`;
    } else if (riskGateRequired && !(state.humanGateApproved ?? false)) {
      // T8：风险分级 HITL —— 高风险低置信度意见 → 必过人工门（优先于收敛/升级/abort）
      decisionType = 'risk_gate_hitel';
      reasoning = `round-${round}: ${riskGateCount} high-risk low-confidence finding(s) (< ${RISK_GATE_MIN_CONFIDENCE}) → risk_gate_hitel (human gate)`;
    } else if (round >= 2 && convergenceOk) {
      // T2：显式收敛信号命中 → 收敛
      decisionType = 'converge';
      reasoning = `round-${round}: convergence signal reached (allAgree=${allAgreeOk}, noNewArguments=${noNewArgumentsOk}) → converge`;
    } else if (round >= 2 && !convergenceOk && (state.escalationCount ?? 0) < ESCALATE_MAX && round + 1 <= gates.maxRounds) {
      // T7：辩论未收敛且有扩容空间 → 扩大评审面板（扩容 1–2 角色后重派发一轮）
      decisionType = 'escalate';
      reasoning = `round-${round}: no convergence signal (allAgree=${allAgreeOk}, noNewArguments=${noNewArgumentsOk}) → escalate (panel expansion #${(state.escalationCount ?? 0) + 1})`;
    } else if (round >= 2 && !convergenceOk) {
      // T7：扩容后仍未收敛 / 无扩容空间 → 转人工（优雅退出，非 abort）
      decisionType = 'escalate_to_human';
      reasoning = `round-${round}: no convergence signal after ${(state.escalationCount ?? 0)} expansion(s) → escalate_to_human`;
    } else if (round >= gates.maxRounds) {
      // 9.5b max_rounds 兜底：非人工路径到顶 → 强停（最后手段）
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

}

/** 把决策落库后回读为 state 引用（供 ReviewState.moderatorDecisions 使用）。 */
export function toDecisionRef(d: ModeratorDecision): ModeratorDecisionRef {
  return { decisionId: d.id, round: d.round, decisionType: d.decisionType };
}
