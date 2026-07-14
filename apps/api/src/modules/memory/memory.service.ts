/**
 * memory.service.ts — MemoryService（Sprint 5.1 P3，标准 Gate）
 *
 * 职责（Contract §3）：
 *  - 四层 Memory 的蒸馏读写：Reviewer（跨评审会长期）/ Project（项目周期）
 *  - Session 由 P1 状态机管理（不在此重复存储）
 *  - Rolling Summary 压缩（多轮上下文膨胀控制）
 *
 * 红线（Contract §8 / Implementation §4）：
 *  -  distillation 为确定性规则，绝不调用真实 LLM
 *  -  **memory 不存聊天历史**：ReviewerMemory 仅存蒸馏 profile（维度擅长 / 偏见摘要），
 *     不含 opinion.issue / recommendation 原文。Rolling summary 为临时上下文（返回字符串，不落 Memory 表）。
 *  - 仅读写 ReviewerMemory / ProjectMemory 两表（Contract §6 声明范围）。
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface ReviewerProfile {
  readonly roleCode: string;
  readonly tenantId: string;
  readonly reviewerUserId: string;
  readonly strengthDimensions: ReadonlyArray<{
    dimension: string;
    confidenceAvg: number;
    reviewCount: number;
  }>;
  readonly biasIndicators: ReadonlyArray<{
    indicator: string;
    evidenceCount: number;
    lastObservedAt: string;
  }>;
  readonly overallConfidenceAvg: number;
  readonly totalReviews: number;
  readonly lastReviewAt: string;
  readonly updatedAt: string;
}

export interface ProjectMemory {
  readonly projectId: string;
  readonly tenantId: string;
  readonly background: string;
  readonly historicalDecisions: ReadonlyArray<{
    decision: string;
    reviewId: string;
    decidedAt: string;
  }>;
  readonly constraints: ReadonlyArray<string>;
  readonly updatedAt: string;
}

export interface MemoryService {
  getReviewerProfile(
    roleCode: string,
    reviewerUserId: string,
    tenantId: string,
  ): Promise<ReviewerProfile | null>;
  updateReviewerProfile(reviewId: string): Promise<ReviewerProfile>;
  getProjectMemory(tenantId: string, projectId?: string): Promise<ProjectMemory | null>;
  updateProjectMemory(reviewId: string): Promise<ProjectMemory>;
  compressRoundContext(reviewId: string, round: number): Promise<string>;
  getContextSummary(reviewId: string): Promise<string>;
}

// Rolling summary 策略（Contract §3.6，mock 截断）
const COMPRESS_TRIGGER_ROUND = 3;
const COMPRESSION_RATIO = 0.3;

@Injectable()
export class MemoryServiceImpl implements MemoryService {
  private readonly logger = new Logger(MemoryServiceImpl.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Reviewer 蒸馏 profile ──

  async getReviewerProfile(
    roleCode: string,
    reviewerUserId: string,
    tenantId: string,
  ): Promise<ReviewerProfile | null> {
    const rec = await this.prisma.reviewerMemory.findFirst({
      where: { tenantId, roleCode, reviewerUserId },
    });
    if (!rec) return null;
    return this.parseReviewerProfile(rec.profile);
  }

  /**
   * 从该场 review 的 opinions 聚合维度置信度 + 检测偏见模式。
   * 幂等：每次从 DB 重新聚合（totalReviews 取全租户累计计数），重复调用不累加。
   * 绝不存聊天历史原文（仅存维度擅长 / 偏见摘要）。
   */
  async updateReviewerProfile(reviewId: string): Promise<ReviewerProfile> {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      select: { tenantId: true, createdBy: true, updatedAt: true },
    });
    if (!review) throw new Error(`Review not found: ${reviewId}`);

    const opinions = await this.prisma.reviewOpinion.findMany({
      where: { reviewId },
      include: { turn: true },
    }) as any[];

    // 映射 turn.roleVersionId → role.code（ReviewTurn 无 roleVersion 导航关系，走标量 roleVersionId）
    const rvIds = Array.from(new Set(opinions.map((o) => o.turn?.roleVersionId).filter(Boolean)));
    const rvCodeMap = new Map<string, string>();
    if (rvIds.length) {
      const rvs = await this.prisma.agentRoleVersion.findMany({
        where: { id: { in: rvIds } },
        include: { role: true },
      });
      for (const rv of rvs) rvCodeMap.set(rv.id, (rv as any).role?.code ?? '');
    }

    // 按 roleCode 分组（一个 review 可能含多角色）
    const groups = new Map<string, any[]>();
    for (const o of opinions) {
      const code = o.turn?.roleVersionId ? rvCodeMap.get(o.turn.roleVersionId) : undefined;
      if (!code) continue;
      if (!groups.has(code)) groups.set(code, []);
      groups.get(code)!.push(o);
    }

    let chosen: ReviewerProfile | null = null;
    let chosenCount = -1;

    for (const [roleCode, group] of groups.entries()) {
      // totalReviews 取本场该角色 opinion 数（幂等：重复调用不累加）
      const profile = this.aggregateReviewerProfile(
        roleCode,
        review.tenantId,
        review.createdBy,
        group,
        review.updatedAt,
        group.length,
      );

      await this.upsertReviewerMemory(review.tenantId, roleCode, review.createdBy, profile);

      if (group.length > chosenCount) {
        chosenCount = group.length;
        chosen = profile;
      }
    }

    if (chosen) return chosen;

    // 无 opinion 时的默认 profile（不落库）
    const now = new Date().toISOString();
    return {
      roleCode: '',
      tenantId: review.tenantId,
      reviewerUserId: review.createdBy,
      strengthDimensions: [],
      biasIndicators: [],
      overallConfidenceAvg: 0,
      totalReviews: 0,
      lastReviewAt: now,
      updatedAt: now,
    };
  }

  private aggregateReviewerProfile(
    roleCode: string,
    tenantId: string,
    reviewerUserId: string,
    group: any[],
    reviewUpdatedAt: Date,
    totalReviews: number,
  ): ReviewerProfile {
    // 维度聚合
    const byDim = new Map<string, number[]>();
    let confSum = 0;
    let highCount = 0;
    for (const o of group) {
      const dim = o.dimension || 'unknown';
      if (!byDim.has(dim)) byDim.set(dim, []);
      byDim.get(dim)!.push(typeof o.confidenceScore === 'number' ? o.confidenceScore : 0);
      confSum += typeof o.confidenceScore === 'number' ? o.confidenceScore : 0;
      if (o.riskLevel === 'high') highCount++;
    }
    const strengthDimensions = Array.from(byDim.entries()).map(([dimension, scores]) => ({
      dimension,
      confidenceAvg: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
      reviewCount: scores.length,
    }));

    // 偏见检测（确定性规则，仅产出标签，不存原文）
    const biasIndicators: Array<{ indicator: string; evidenceCount: number; lastObservedAt: string }> = [];
    const now = new Date().toISOString();
    if (group.length > 0 && highCount / group.length > 0.5) {
      biasIndicators.push({
        indicator: '倾向于高风险标记',
        evidenceCount: highCount,
        lastObservedAt: now,
      });
    }

    return {
      roleCode,
      tenantId,
      reviewerUserId,
      strengthDimensions,
      biasIndicators,
      overallConfidenceAvg: group.length ? Math.round(confSum / group.length) : 0,
      totalReviews, // 全租户累计计数（幂等）
      lastReviewAt: reviewUpdatedAt instanceof Date ? reviewUpdatedAt.toISOString() : String(reviewUpdatedAt),
      updatedAt: now,
    };
  }

  private async upsertReviewerMemory(
    tenantId: string,
    roleCode: string,
    reviewerUserId: string,
    profile: ReviewerProfile,
  ): Promise<void> {
    const existing = await this.prisma.reviewerMemory.findFirst({
      where: { tenantId, roleCode, reviewerUserId },
    });
    const data = {
      tenantId,
      roleCode,
      reviewerUserId,
      profile: profile as any,
      totalReviews: profile.totalReviews,
      lastReviewAt: profile.lastReviewAt ? new Date(profile.lastReviewAt) : null,
    };
    if (existing) {
      await this.prisma.reviewerMemory.update({ where: { id: existing.id }, data });
    } else {
      await this.prisma.reviewerMemory.create({ data: { ...data, updatedAt: new Date() } });
    }
  }

  private parseReviewerProfile(raw: any): ReviewerProfile {
    const p = raw ?? {};
    return {
      roleCode: p.roleCode ?? '',
      tenantId: p.tenantId ?? '',
      reviewerUserId: p.reviewerUserId ?? '',
      strengthDimensions: p.strengthDimensions ?? [],
      biasIndicators: p.biasIndicators ?? [],
      overallConfidenceAvg: p.overallConfidenceAvg ?? 0,
      totalReviews: p.totalReviews ?? 0,
      lastReviewAt: p.lastReviewAt ?? '',
      updatedAt: p.updatedAt ?? '',
    };
  }

  // ── Project 知识 ──

  async getProjectMemory(tenantId: string, projectId?: string): Promise<ProjectMemory | null> {
    const pid = projectId ?? tenantId; // 首次用 tenantId 代理
    const rec = await this.prisma.projectMemory.findFirst({ where: { tenantId, projectId: pid } });
    if (!rec) return null;
    return this.parseProjectMemory(rec);
  }

  /**
   * 从 report.actionItems 提取标题作为 decision（mock），约束留空。
   * 幂等：每次从 report 重新提取（同 review 同结果）。
   */
  async updateProjectMemory(reviewId: string): Promise<ProjectMemory> {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      select: { tenantId: true, updatedAt: true },
    });
    if (!review) throw new Error(`Review not found: ${reviewId}`);

    const projectId = review.tenantId;
    const report = await this.prisma.report.findUnique({
      where: { reviewId },
      include: { actionItems: true },
    });
    const decidedAt = new Date().toISOString();
    const historicalDecisions = (report?.actionItems ?? []).map((a: any) => ({
      decision: a.title,
      reviewId,
      decidedAt,
    }));

    const existing = await this.prisma.projectMemory.findFirst({ where: { tenantId: review.tenantId, projectId } });
    const data = {
      tenantId: review.tenantId,
      projectId,
      background: existing?.background ?? '',
      decisions: historicalDecisions as any,
      constraints: existing?.constraints ?? [],
      updatedAt: new Date(),
    };
    let rec;
    if (existing) {
      rec = await this.prisma.projectMemory.update({ where: { id: existing.id }, data });
    } else {
      rec = await this.prisma.projectMemory.create({ data });
    }
    return this.parseProjectMemory(rec);
  }

  private parseProjectMemory(raw: any): ProjectMemory {
    const p = raw ?? {};
    return {
      projectId: p.projectId ?? '',
      tenantId: p.tenantId ?? '',
      background: p.background ?? '',
      historicalDecisions: p.decisions ?? [],
      constraints: p.constraints ?? [],
      updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : String(p.updatedAt ?? ''),
    };
  }

  // ── Rolling Summary ──

  /**
   * 压缩 round 之前的原文发言为增量摘要。
   * mock：拼接 前序 round 的 issue + recommendation，按 compression_ratio 截断（确定性，不调 LLM）。
   */
  async compressRoundContext(reviewId: string, round: number): Promise<string> {
    if (round < COMPRESS_TRIGGER_ROUND) {
      // 前两轮原文保留（Contract §3.6 compress_trigger_round=3）
      return '';
    }
    const prior = await this.prisma.reviewOpinion.findMany({
      where: { reviewId, turn: { round: { lt: round } } },
      include: { turn: true },
      orderBy: { createdAt: 'asc' },
    });
    if (prior.length === 0) return '';

    const full = prior
      .map((o) => `R${o.turn?.round ?? '?'} [${o.dimension}] ${o.issue} → ${o.recommendation}`)
      .join('\n');

    if (full.length === 0) return '';
    const keep = Math.max(1, Math.ceil(full.length * COMPRESSION_RATIO));
    return full.slice(0, keep);
  }

  /** KB 上下文（mock 返回固定占位，不调真实 embedding）。 */
  async getContextSummary(_reviewId: string): Promise<string> {
    return 'KB 未配置';
  }
}

/** Contract §5.2 NodeCtx 注入工厂。 */
export function createMemoryService(prisma: PrismaService): MemoryService {
  return new MemoryServiceImpl(prisma);
}
