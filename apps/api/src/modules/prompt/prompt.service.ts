/**
 * prompt.service.ts — PromptService（Sprint 5.1 P3，标准 Gate）
 *
 * 职责（Contract §2）：
 *  - 版本化 prompt 模板注册表（base / task / context / format 四层）
 *  - 按四层组装最终 prompt（system + user），每条 prompt 快照溯源 templateRefs
 *  - registerTemplate / getActiveTemplate / getTemplateHistory / rollbackTo
 *  - 首次数据迁移：AgentRoleVersion.systemPrompt → PromptTemplateRecord base v1.0
 *
 * 红线（Contract §8 / Implementation §4）：
 *  - 默认 mock：组装为确定性规则，绝不调用真实 LLM
 *  - 仅读写 PromptTemplateRecord 表（Contract §6 声明范围）
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SYSTEM_PROMPT } from '../reviews/provider/model-adapter';
import type { MemoryService } from '../memory/memory.service';
import type { ReviewState } from '../reviews/orchestrator/graph-runtime';

export type PromptLayer = 'base' | 'task' | 'context' | 'format';

export interface PromptMetadata {
  readonly description: string;
  readonly createdBy: string; // userId
  readonly changeReason?: string;
  readonly schemaVersion: string; // 关联 opinion schemaVersion "1.0"
}

/** registerTemplate 入参：version 可省略（自动从最新版本 +0.1）。 */
export type RegisterTemplateInput = {
  readonly roleCode: string;
  readonly layer: PromptLayer;
  readonly content: string;
  readonly version?: string;
  readonly metadata: PromptMetadata;
};

export interface PromptTemplate {
  readonly id: string;
  readonly roleCode: string;
  readonly version: string;
  readonly layer: PromptLayer;
  readonly content: string;
  readonly metadata: PromptMetadata;
  readonly createdAt: string;
}

export interface ComposedPrompt {
  readonly system: string;
  readonly user: string;
  readonly templateRefs: ReadonlyArray<{
    layer: PromptLayer;
    templateId: string;
    version: string;
  }>;
}

export interface PromptComposeCtx {
  readonly reviewId: string;
  readonly roleCode: string;
  readonly round: number;
  readonly phase: 'round_robin' | 'debate';
  readonly memoryService?: MemoryService; // P3 注入位（蒸馏 context 层）
}

export interface PromptService {
  compose(ctx: PromptComposeCtx): Promise<ComposedPrompt>;
  registerTemplate(template: RegisterTemplateInput): Promise<PromptTemplate>;
  getActiveTemplate(roleCode: string, layer: PromptLayer): Promise<PromptTemplate | null>;
  getTemplateHistory(roleCode: string, layer?: PromptLayer): Promise<PromptTemplate[]>;
  rollbackTo(roleCode: string, layer: PromptLayer, version: string): Promise<PromptTemplate>;
}

@Injectable()
export class PromptServiceImpl implements PromptService {
  private readonly logger = new Logger(PromptServiceImpl.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 四层组装：base → task → context → format 拼接为 system；user 由调用方注入方案。
   * mock 下：content 取自模板注册表（确定性），context 层仅注入蒸馏 profile（无原文历史）。
   */
  async compose(ctx: PromptComposeCtx): Promise<ComposedPrompt> {
    const { reviewId, roleCode, round, phase } = ctx;

    const base = await this.getActiveTemplate(roleCode, 'base');
    const task = await this.getActiveTemplate(roleCode, 'task');
    const format = await this.getActiveTemplate(roleCode, 'format');

    const baseContent = base?.content ?? `You are a technical reviewer acting as ${roleCode}.`;
    const formatContent = format?.content ?? SYSTEM_PROMPT;

    // task 层：按 round 注入阶段说明（模板内容 + 阶段前缀）。round-1 初始评审；round≥2 辩论回应。
    const roundNote =
      round >= 2
        ? `[Phase: debate, Round ${round}] Provide a debate-style response addressing other reviewers' points and unresolved conflicts.`
        : `[Phase: initial review, Round ${round}] Provide your initial assessment across the review dimensions.`;
    const taskContent = [roundNote, task?.content].filter(Boolean).join('\n');

    // context 层：仅注入蒸馏 profile（不注入原文历史），经可选 MemoryService。
    let contextContent = '';
    if (ctx.memoryService) {
      contextContent = await this.buildContextLayer(ctx.memoryService, reviewId, roleCode);
    }

    const system = [baseContent, taskContent, contextContent, formatContent]
      .filter(Boolean)
      .join('\n\n');

    // user 骨架：保留 "You are reviewing as {roleCode}." 前缀，确保下游 mock 适配器可提取角色。
    const user = `You are reviewing as ${roleCode}.\n\nThe proposal and prior discussion are supplied by the orchestrator.`;

    const templateRefs = [
      { layer: 'base' as const, templateId: base?.id ?? 'none', version: base?.version ?? '0.0' },
      { layer: 'task' as const, templateId: task?.id ?? 'none', version: task?.version ?? '0.0' },
      { layer: 'context' as const, templateId: 'memory-context', version: '1.0' },
      { layer: 'format' as const, templateId: format?.id ?? 'none', version: format?.version ?? '0.0' },
    ];

    return { system, user, templateRefs };
  }

  /**
   * 仅注入蒸馏 profile（维度擅长 / 偏见摘要），绝不注入 opinion.issue 等原文历史。
   */
  private async buildContextLayer(
    memoryService: MemoryService,
    reviewId: string,
    roleCode: string,
  ): Promise<string> {
    const parts: string[] = [];
    try {
      const kb = await memoryService.getContextSummary(reviewId);
      if (kb && kb.trim()) parts.push(`[Knowledge Context] ${kb}`);
    } catch {
      /* KB mock 不可用则跳过 */
    }
    try {
      const review = await this.prisma.review.findUnique({
        where: { id: reviewId },
        select: { tenantId: true, createdBy: true },
      });
      if (review) {
        const profile = await memoryService.getReviewerProfile(roleCode, review.createdBy, review.tenantId);
        if (profile?.biasIndicators?.length) {
          const bias = profile.biasIndicators.map((b) => b.indicator).join('; ');
          parts.push(`[Reviewer Distillation] Known bias notes: ${bias}`);
        }
      }
    } catch {
      /* profile 未就绪则跳过 */
    }
    return parts.join('\n');
  }

  async registerTemplate(template: RegisterTemplateInput): Promise<PromptTemplate> {
    // 版本自增：未显式给 version 时，取该 (roleCode, layer) 最新版本 +0.1
    let version = template.version;
    if (!version) {
      const latest = await this.getActiveTemplate(template.roleCode, template.layer);
      version = latest ? this.bumpVersion(latest.version) : '1.0';
    }

    const createdBy =
      (template.metadata as PromptMetadata | undefined)?.createdBy ?? '00000000-0000-0000-0000-000000000000';

    const rec = await this.prisma.promptTemplateRecord.create({
      data: {
        roleCode: template.roleCode,
        layer: template.layer,
        version,
        content: template.content,
        metadata: (template.metadata ?? { description: '', createdBy, schemaVersion: '1.0' }) as any,
        createdBy,
      },
    });
    this.logger.log(`Registered prompt template ${template.roleCode}/${template.layer}@${version}`);
    return this.toTemplate(rec);
  }

  async getActiveTemplate(roleCode: string, layer: PromptLayer): Promise<PromptTemplate | null> {
    const rec = await this.prisma.promptTemplateRecord.findFirst({
      where: { roleCode, layer },
      orderBy: { createdAt: 'desc' },
    });
    return rec ? this.toTemplate(rec) : null;
  }

  async getTemplateHistory(roleCode: string, layer?: PromptLayer): Promise<PromptTemplate[]> {
    const recs = await this.prisma.promptTemplateRecord.findMany({
      where: layer ? { roleCode, layer } : { roleCode },
      orderBy: { createdAt: 'asc' },
    });
    return recs.map((r) => this.toTemplate(r));
  }

  /** 回滚：创建新版本，内容复制自历史版本（不删旧版，保证历史 opinion 可溯）。 */
  async rollbackTo(roleCode: string, layer: PromptLayer, version: string): Promise<PromptTemplate> {
    const src = await this.prisma.promptTemplateRecord.findFirst({
      where: { roleCode, layer, version },
    });
    if (!src) throw new Error(`PromptTemplate not found: ${roleCode}/${layer}/${version}`);
    const srcMeta = (src.metadata as unknown as PromptMetadata | undefined) ?? ({} as PromptMetadata);
    return this.registerTemplate({
      roleCode,
      layer,
      content: src.content,
      metadata: {
        description: srcMeta.description ?? 'rollback',
        createdBy: srcMeta.createdBy ?? src.createdBy,
        changeReason: `rollback from ${version}`,
        schemaVersion: srcMeta.schemaVersion ?? '1.0',
      },
    });
  }

  /**
   * 为 LlmModerator 组装 system prompt（P4 §4.3）。
   * 确定性 mock 内容（不调真实 LLM），描述评审状态 + 可用工具 + 收敛信号，
   * 作为真 LLM 模式下的 system prompt 骨架。env-gated，默认不启用。
   */
  async composeForModerator(state: ReviewState): Promise<string> {
    const knownDimensions = [
      '架构合理性',
      '投入产出分析',
      '交付风险',
      '数据安全与合规',
      '用户体验',
    ];
    const voterCount = Object.keys(state.usage.turnsByReviewer).length;
    return [
      'You are the Moderator of a multi-agent review board.',
      'Your job: decide whether the review should converge (output report), continue to another round of debate, or stop.',
      '',
      `## Current State`,
      `- round: ${state.round}`,
      `- reviewers spoken: ${voterCount}`,
      `- dimensions covered: ${knownDimensions.join(', ')}`,
      '',
      `## Valid decisionType Values (choose exactly ONE)`,
      `- "converge": reviewers have reached sufficient consensus → output final report`,
      `- "continue_debate": meaningful conflict remains → schedule another round`,
      `- "advance_round": minimum rounds not yet met → must continue`,
      `- "force_stop": max rounds reached or critical issue requires immediate halt`,
      `- "propose_tool": external tool/knowledge needed before deciding (specify in proposedTools)`,
      '',
      '## Output Format (STRICT JSON, no markdown, no explanation)',
      '{"decisionType":"converge","reasoning":"<1-2 sentences explaining why>","proposedTools":[]}',
      '',
      'Return ONLY the JSON object, no other text.',
    ].join('\n');
  }

  private bumpVersion(v: string): string {
    const m = /^(\d+)\.(\d+)$/.exec(v.trim());
    if (!m) return '1.1';
    const major = parseInt(m[1], 10);
    const minor = parseInt(m[2], 10);
    return `${major}.${minor + 1}`;
  }

  private toTemplate(rec: any): PromptTemplate {
    return {
      id: rec.id,
      roleCode: rec.roleCode,
      version: rec.version,
      layer: rec.layer as PromptLayer,
      content: rec.content,
      metadata: (rec.metadata ?? { description: '', createdBy: rec.createdBy, schemaVersion: '1.0' }) as PromptMetadata,
      createdAt: rec.createdAt instanceof Date ? rec.createdAt.toISOString() : String(rec.createdAt),
    };
  }
}

/** Contract §5.2 NodeCtx 注入工厂。 */
export function createPromptService(prisma: PrismaService): PromptService {
  return new PromptServiceImpl(prisma);
}

/**
 * 首次数据迁移（Implementation §2.4 / Contract §2.5）：
 * 把 AgentRoleVersion.systemPrompt → PromptTemplateRecord base v1.0；
 * task / format 层用默认内容同步。对每个 preset role 生成 base/task/format 三模板。
 * 幂等：已存在 (roleCode, layer, version) 则跳过。
 */
export async function seedPresetPromptTemplates(prisma: PrismaService): Promise<{ created: number }> {
  const versions = await prisma.agentRoleVersion.findMany({ include: { role: true } });
  let created = 0;
  for (const v of versions) {
    const roleCode = v.role.code;
    const createdBy = v.createdBy;
    const baseContent = v.systemPrompt || `You are a technical reviewer acting as ${roleCode}.`;
    created += await upsertTemplate(prisma, roleCode, 'base', '1.0', baseContent, {
      description: 'Synced from AgentRoleVersion.systemPrompt',
      createdBy,
      changeReason: 'initial sync',
      schemaVersion: '1.0',
    });
    const taskContent =
      'Review the proposal across the assigned dimensions. Identify risks, provide actionable ' +
      'recommendations, and assign a confidence score (0-100). Output structured opinions.';
    created += await upsertTemplate(prisma, roleCode, 'task', '1.0', taskContent, {
      description: 'Default task layer (initial review + debate)',
      createdBy,
      changeReason: 'initial sync',
      schemaVersion: '1.0',
    });
    const formatContent = buildFormatContent(v.outputSchema);
    created += await upsertTemplate(prisma, roleCode, 'format', '1.0', formatContent, {
      description: 'Output schema (JSON) instruction',
      createdBy,
      changeReason: 'initial sync',
      schemaVersion: '1.0',
    });
  }
  return { created };
}

async function upsertTemplate(
  prisma: PrismaService,
  roleCode: string,
  layer: PromptLayer,
  version: string,
  content: string,
  metadata: PromptMetadata,
): Promise<number> {
  const existing = await prisma.promptTemplateRecord.findFirst({ where: { roleCode, layer, version } });
  if (existing) return 0;
  await prisma.promptTemplateRecord.create({
    data: {
      roleCode,
      layer,
      version,
      content,
      metadata: metadata as any,
      createdBy: metadata.createdBy,
    },
  });
  return 1;
}

function buildFormatContent(outputSchema: unknown): string {
  const base =
    'Output a single JSON object with exactly these fields: riskLevel (high|medium|low|info), ' +
    'dimension, issue, recommendation, confidenceScore (0-100). Output ONLY valid JSON, no markdown, no explanation.';
  try {
    const schema = outputSchema as { dimensions?: unknown[] } | null;
    if (schema?.dimensions && Array.isArray(schema.dimensions) && schema.dimensions.length > 0) {
      const dims = schema.dimensions
        .map((d: any) => (typeof d === 'string' ? d : d?.name || d?.dimension || ''))
        .filter(Boolean)
        .join(', ');
      if (dims) return `${base}\nExpected dimensions include: ${dims}.`;
    }
  } catch {
    /* ignore */
  }
  return base;
}
