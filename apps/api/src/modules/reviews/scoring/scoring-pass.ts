/**
 * scoring-pass.ts — T4 (Sprint 11.0) 观察/判断分离：Scoring Pass
 *
 * 设计（来源 AssessmentAI 模式 O + T3 scoreDiscipline）：
 *  - 评审员产出观察（issue/recommendation/citations/riskLevel），不再自评分（confidenceScore 可选）；
 *  - 收敛后，ScoringPass 基于全部观察 + workflow.scoreDiscipline（默认锚定）聚合每个维度的质量分；
 *  - 分数写入 ReviewOpinion.score；ScoringService 聚合时 score 优先于 reviewer confidenceScore。
 *
 * 分两层：
 *  1. computeDimensionScores —— 纯函数（mock 确定性公式），可单测；
 *  2. ScoringPassService —— NestJS：读意见 → 计算 → 落库 score + 审计（不阻塞主流程）。
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { WorkflowRegistry } from '../../workflow/workflow.registry';
import { DEFAULT_SCORE_DISCIPLINE } from '../../workflow/workflow.registry';
import { isReportable } from '../orchestrator/opinion-lifecycle';

export interface ScoringPassInput {
  readonly id: string;
  readonly dimension: string;
  readonly riskLevel: string;
  readonly status?: string | null;
}

/**
 * mock 确定性评分公式：
 *   base = workflow.scoreDiscipline.defaultAnchor（T3，默认 55）
 *   维度内每条意见按 risk 微调：high -12 / medium -5 / low +4 / info +8
 *   最终 clamp 0-100 取整。
 * 语义：默认锚定（防通胀）+ 风险惩罚；与 ScoringService.riskPenalty 方向一致，但这是"维度质量分"。
 */
export function computeDimensionScores(
  opinions: readonly ScoringPassInput[],
  discipline: { defaultAnchor: number },
): Record<string, number> {
  const byDim = new Map<string, string[]>();
  for (const o of opinions) {
    const dim = o.dimension || '未分类';
    if (!byDim.has(dim)) byDim.set(dim, []);
    byDim.get(dim)!.push((o.riskLevel || 'info').toLowerCase());
  }
  const base = typeof discipline?.defaultAnchor === 'number' ? discipline.defaultAnchor : 55;
  const result: Record<string, number> = {};
  for (const [dim, risks] of byDim) {
    let s = base;
    for (const r of risks) {
      if (r === 'high') s -= 12;
      else if (r === 'medium') s -= 5;
      else if (r === 'low') s += 4;
      else s += 8; // info
    }
    result[dim] = Math.max(0, Math.min(100, Math.round(s)));
  }
  return result;
}

/**
 * 评分 pass 服务：评审收敛后调用一次，为 reportable 意见写入维度质量分。
 * 失败不抛错（记日志），报告侧回退 reviewer confidenceScore（score 为 null 时）。
 */
@Injectable()
export class ScoringPassService {
  private readonly logger = new Logger(ScoringPassService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly registry: WorkflowRegistry,
  ) {}

  async run(
    reviewId: string,
    actor?: { tenantId?: string; userId?: string },
  ): Promise<{ scored: number; dimensions: string[] }> {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      select: { mode: true, tenantId: true },
    });
    const config = this.registry.resolve(review?.mode ?? 'enterprise');
    const discipline = config.scoreDiscipline ?? DEFAULT_SCORE_DISCIPLINE;

    const opinions = await this.prisma.reviewOpinion.findMany({
      where: { reviewId },
      select: { id: true, dimension: true, riskLevel: true, status: true },
    });
    const reportable = opinions.filter((o) => isReportable(o.status));
    if (reportable.length === 0) return { scored: 0, dimensions: [] };

    const scores = computeDimensionScores(reportable, discipline);

    await this.prisma.$transaction(async (tx) => {
      for (const o of reportable) {
        const dim = o.dimension || '未分类';
        if (typeof scores[dim] !== 'number') continue;
        await tx.reviewOpinion.update({
          where: { id: o.id },
          data: { score: scores[dim] },
        });
      }
    });

    void this.audit.log({
      tenantId: actor?.tenantId ?? review?.tenantId ?? '00000000-0000-0000-0000-000000000000',
      userId: actor?.userId ?? null,
      action: 'review.scoring_pass.run',
      resource: 'review',
      resourceId: reviewId,
      detail: { dimensions: Object.keys(scores), scored: reportable.length, anchor: discipline.defaultAnchor },
    });

    this.logger.log(
      `ScoringPass ${reviewId.substring(0, 8)}: scored=${reportable.length} dims=${Object.keys(scores).length} (anchor=${discipline.defaultAnchor})`,
    );
    return { scored: reportable.length, dimensions: Object.keys(scores) };
  }
}
