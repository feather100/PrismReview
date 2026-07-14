/**
 * llm-moderator.ts — P4 真 LLM Moderator（Contract §4，标准 Gate）
 *
 * 与 MockModerator 同签名（`decide(state, gates)`），新增 3 个方法
 * （narrate / proposeTools / sanityCheck）+ fallbackDecision。
 *
 * 红线（Contract §4.3 / §5 / Implementation §5）：
 *  - env-gated：仅 `MODERATOR_PROVIDER=llm && ALLOW_EXTERNAL_MODEL_CALLS=true`
 *    才经 createModerator() 构造本类；否则返回 MockModerator。
 *  - 复用既有 createProviderAdapter() 工厂选底层 provider（longcat / lmstudio /
 *    openai_compatible），不新建 LongCat 专有 adapter。
 *  - LLM 调用失败 → fail-closed → 回退 MockModerator.decide() + 审计标记。
 *  - 硬闸代码强制（computeRuleCheck），LLM 不可覆盖（越界 → force_stop）。
 *  - 不引入 bcrypt / 真实 MCP SDK；不写密钥（脱敏 llmRawOutput）。
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ReviewState, ModeratorDecisionType } from './graph-runtime';
import {
  Moderator,
  ModeratorDecision,
  MockModerator,
  HardGates,
  RuleCheckResult,
  computeRuleCheck,
} from './moderator';
import type { WorkflowConfig } from '../../workflow/workflow.registry';
import type { ToolType } from '../../tool/tool.registry';
import { ModelAdapter, stripMarkdown } from '../provider/model-adapter';
import { createProviderAdapter } from '../provider/provider-factory';
import type { PromptServiceImpl } from '../../prompt/prompt.service';

const ALLOWED_DECISION_TYPES: ModeratorDecisionType[] = [
  'advance_round',
  'continue_debate',
  'converge',
  'force_stop',
  'terminate_proposal',
  'tool_approval',
  'propose_tool',
];

const KNOWN_DIMENSIONS = [
  '架构合理性',
  '投入产出分析',
  '交付风险',
  '数据安全与合规',
  '用户体验',
];

@Injectable()
export class LlmModerator implements Moderator {
  private readonly logger = new Logger(LlmModerator.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly modelAdapter: ModelAdapter, // 经 createProviderAdapter() 注入（含 LongCat）
    private readonly promptService: PromptServiceImpl, // P3
  ) {}

  /**
   * 替代 MockModerator.decide() — 真 LLM 决策（经 modelAdapter）。
   * 失败时 fail-closed 回退 MockModerator.decide()（Contract §4.3）。
   * 硬闸代码强制：无论 LLM 返回什么，越界 → force_stop（LLM 不可覆盖）。
   */
  async decide(state: Readonly<ReviewState>, gates: HardGates, config?: WorkflowConfig): Promise<ModeratorDecision> {
    let decisionType: ModeratorDecisionType = 'converge';
    let reasoning = '';
    let proposedTools: string[] = [];
    let raw = '';

    try {
      const prompt = await this.promptService.composeForModerator(state);
      const out = await this.modelAdapter.complete({
        prompt,
        system: prompt,
        temperature: 0.3,
        maxTokens: 1000,
      });
      raw = out.text;
      const parsed = this.parseDecision(raw);
      decisionType = parsed.decisionType;
      reasoning = parsed.reasoning || '';
      // P5（§6.2）：PROPOSE_TOOLS 时按 workflow.availableTools 过滤（仅保留预设允许的工具）
      proposedTools = this.filterToolsByWorkflow(parsed.proposedTools || [], config);
    } catch (e: any) {
      // LLM 调用失败 → fail-closed → 回退 MockModerator（Contract §4.3）
      return this.fallbackDecision(state, gates, 'adapter_failure: ' + (e?.message || String(e)));
    }

    // ── 硬闸（代码强制，LLM 不可覆盖）──
    const ruleCheckResult: RuleCheckResult = computeRuleCheck(state, gates);
    if (!ruleCheckResult.passed) {
      decisionType = 'force_stop';
      reasoning = `hard gate breached → force_stop (LLM override blocked): ${reasoning}`;
    }

    const record = await this.prisma.moderatorDecision.create({
      data: {
        reviewId: state.reviewId,
        round: state.round,
        decisionType,
        reasoning,
        ruleCheckResult: ruleCheckResult as unknown as object,
        proposedTools,
        toolApprovalReasoning: null,
        llmRawOutput: this.sanitize(raw),
      },
    });

    this.logger.log(
      `LlmModerator decision: review=${state.reviewId.substring(0, 8)} round=${state.round} type=${decisionType} passed=${ruleCheckResult.passed}`,
    );

    return {
      id: record.id,
      reviewId: state.reviewId,
      round: state.round,
      decisionType,
      reasoning,
      ruleCheckResult,
      createdAt: record.createdAt.toISOString(),
      proposedTools,
      llmRawOutput: this.sanitize(raw),
      providerSource: 'llm',
    };
  }

  /** LLM 生成本轮汇总叙事（供 ReportingService 使用）。失败降级固定叙事。 */
  async narrate(state: Readonly<ReviewState>): Promise<string> {
    try {
      const prompt = await this.promptService.composeForModerator(state);
      const out = await this.modelAdapter.complete({
        prompt: `${prompt}\n\n请输出本轮评审的中文汇总叙事（200 字内）。`,
        system: prompt,
        temperature: 0.4,
        maxTokens: 800,
      });
      return (out.text || '').trim() || this.fallbackNarrative(state);
    } catch {
      return this.fallbackNarrative(state);
    }
  }

  /** LLM 提议本轮可用工具名（knowledge_search / code_analysis 等）。失败降级：返回空数组（不提议工具）。 */
  async proposeTools(state: Readonly<ReviewState>, config?: WorkflowConfig): Promise<string[]> {
    try {
      const prompt = await this.promptService.composeForModerator(state);
      const out = await this.modelAdapter.complete({
        prompt: `${prompt}\n\n请仅输出 proposedTools 数组。`,
        system: prompt,
        temperature: 0.3,
        maxTokens: 500,
      });
      const parsed = this.parseDecision(out.text);
      const tools = parsed.proposedTools && parsed.proposedTools.length ? parsed.proposedTools : [];
      // P5（§6.2）：按 workflow.availableTools 过滤
      return this.filterToolsByWorkflow(tools, config);
    } catch {
      return []; // mock/failure → 不提议工具
    }
  }

  /**
   * sanity check：收敛 override 时 LLM 反对理由须过 sanity check（非空 + 引用具体未决冲突）。
   * 反对理由非空 且（引用具体维度名 或 引用冲突/high-risk）→ allowed=true；否则驳回。
   */
  sanityCheck(oppositionReason: string, _state: Readonly<ReviewState>): { allowed: boolean; reason: string } {
    const r = (oppositionReason || '').trim();
    if (!r) {
      return { allowed: false, reason: '反对理由不具体（空）' };
    }
    const mentionsDimension = KNOWN_DIMENSIONS.some((d) => r.includes(d));
    const mentionsConflict = /冲突|conflict|未决|unresolved|riskLevel|high/i.test(r);
    if (mentionsDimension || mentionsConflict) {
      return { allowed: true, reason: '反对理由引用了具体维度或冲突' };
    }
    return { allowed: false, reason: '反对理由不具体' };
  }

  /** fail-closed 回退：构造 MockModerator 决策 + 审计标记 providerSource='fallback_mock'。 */
  private async fallbackDecision(
    state: Readonly<ReviewState>,
    gates: HardGates,
    reason: string,
  ): Promise<ModeratorDecision> {
    const mock = new MockModerator(this.prisma);
    const d = await mock.decide(state, gates);
    // 审计：把失败原因写入 llmRawOutput（脱敏），留痕 fail-closed
    try {
      await this.prisma.moderatorDecision.update({
        where: { id: d.id },
        data: { llmRawOutput: this.sanitize(reason) },
      });
    } catch {
      /* 非致命 */
    }
    this.logger.warn(`LlmModerator fail-closed → MockModerator (${reason.substring(0, 120)})`);
    return { ...d, providerSource: 'fallback_mock' };
  }

  private parseDecision(raw: string): {
    decisionType: ModeratorDecisionType;
    reasoning: string;
    proposedTools: string[];
  } {
    let obj: any;
    try {
      obj = JSON.parse(stripMarkdown(raw || ''));
    } catch {
      throw new Error('LLM output is not valid JSON decision');
    }
    const dt = obj?.decisionType;
    if (typeof dt !== 'string' || !ALLOWED_DECISION_TYPES.includes(dt as ModeratorDecisionType)) {
      throw new Error('invalid decisionType from LLM: ' + String(dt));
    }
    return {
      decisionType: dt as ModeratorDecisionType,
      reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : '',
      proposedTools: Array.isArray(obj.proposedTools) ? obj.proposedTools.map(String) : [],
    };
  }

  private fallbackNarrative(state: Readonly<ReviewState>): string {
    return `第 ${state.round} 轮评审已完成，共识/分歧如下：各评审员已提交意见，Moderator 已完成收敛判定。`;
  }

  /** P5（§6.2）：按 workflow.availableTools 过滤 LLM 提议的工具（仅保留预设允许子集）。 */
  private filterToolsByWorkflow(tools: string[], config?: WorkflowConfig): string[] {
    if (!config || !config.availableTools || config.availableTools.length === 0) return tools;
    const allowed = new Set<string>(config.availableTools as string[]);
    return tools.filter((t) => allowed.has(t));
  }

  /** 脱敏 LLM 原始输出（不落库密钥/不提交密钥），并截断长度。 */
  private sanitize(raw: string): string {
    if (!raw) return '';
    let s = String(raw)
      .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer ***')
      .replace(/sk-[A-Za-z0-9]{8,}/g, 'sk-***')
      .replace(/api[_-]?key["'=:\s]+[A-Za-z0-9._-]+/gi, 'apiKey=***');
    if (s.length > 4000) s = s.substring(0, 4000) + '…[truncated]';
    return s;
  }
}

/**
 * env-gated Moderator 工厂（Contract §4.3 / Implementation §3.2）。
 * 复用既有 createProviderAdapter() 选底层 provider（longcat / lmstudio / openai_compatible）。
 *
 *  - MODERATOR_PROVIDER=llm && ALLOW_EXTERNAL_MODEL_CALLS=true → LlmModerator
 *  - 默认 / 未 set / llm 但 ALLOW_EXTERNAL!=true → MockModerator（fail-closed）
 */
export function createModerator(
  prisma: PrismaService,
  modelAdapter: ModelAdapter,
  promptService: PromptServiceImpl,
): Moderator {
  const provider = (process.env.MODERATOR_PROVIDER || '').toLowerCase();
  const allow = process.env.ALLOW_EXTERNAL_MODEL_CALLS || '';

  if (provider === 'llm' && allow === 'true') {
    return new LlmModerator(prisma, modelAdapter, promptService);
  }
  // 默认 / 未 set / llm 但 allow!=true → MockModerator（fail-closed）
  return new MockModerator(prisma);
}

/** 便捷构造：自带 createProviderAdapter()（供 Nest 模块 useFactory 调用）。 */
export function createModeratorWithEnv(
  prisma: PrismaService,
  promptService: PromptServiceImpl,
): Moderator {
  return createModerator(prisma, createProviderAdapter(), promptService);
}
