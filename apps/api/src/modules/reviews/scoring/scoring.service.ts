/**
 * scoring.service.ts — P5 ScoringService（Contract §4）
 *
 * 评分 = 加权平均，**不引入 ML 模型**（纯计算，红线 §9）。
 *
 * 公式（与 Contract §5.4 示例对齐）：
 *   weightedScore(维度) = confidenceAvg(0–100) × riskPenalty × weight
 *   overallScore       = Σ weightedScore  → 四舍五入到 [0,100] 整数
 *
 * riskPenalty（基于该维度最高 riskLevel）：
 *   high → 0.5 | medium → 0.8 | low/info → 1.0
 *
 * 审计红线：评分时把"使用的权重 + verdict 阈值"快照写入 Review.scoringConfig（saveScoringResult）。
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { WorkflowRegistry, WorkflowConfig, WorkflowId } from '../../workflow/workflow.registry';

export interface DimensionScore {
  readonly dimension: string;
  readonly weight: number; // 来自 workflow.scoringWeights / fallback（已归一化到 Σ=1）
  readonly confidenceAvg: number; // 该维度所有 opinion 的平均 confidenceScore (0–100)
  readonly riskPenalty: number; // 0.5 | 0.8 | 1.0（基于最高 riskLevel）
  readonly weightedScore: number; // confidenceAvg × riskPenalty × weight
}

export type Verdict = 'approved' | 'conditionally_approved' | 'rejected';

export interface ScoringCoverage {
  readonly expected: string[]; // workflow.scoringWeights.byDimension 键
  readonly covered: string[]; // opinions 中出现的维度
  readonly missing: string[]; // expected - covered
}

export interface ScoringConfigSnapshot {
  readonly weights: Record<string, number>; // 实际用于评分的维度权重
  readonly thresholds: { readonly approved: number; readonly conditionallyApproved: number };
}

export interface ScoringResult {
  readonly workflowId: WorkflowId;
  readonly dimensionScores: DimensionScore[];
  readonly overallScore: number; // 加权总分 0–100 整数
  readonly verdict: Verdict;
  readonly adoptedRate: number; // recommendation 类意见被保留比例（0–100）
  readonly coverage: ScoringCoverage;
  readonly configSnapshot: ScoringConfigSnapshot; // 审计快照
}

const RISK_PENALTY: Record<string, number> = {
  high: 0.5,
  medium: 0.8,
  low: 1.0,
  info: 1.0,
};

const RISK_SEVERITY: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

function riskPenaltyOf(riskLevels: string[]): number {
  let worst = 'info';
  let worstSev = -1;
  for (const r of riskLevels) {
    const sev = RISK_SEVERITY[(r || 'info').toLowerCase()] ?? 0;
    if (sev > worstSev) {
      worstSev = sev;
      worst = (r || 'info').toLowerCase();
    }
  }
  return RISK_PENALTY[worst] ?? 1.0;
}

@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: WorkflowRegistry,
  ) {}

  /**
   * 从 ReviewOpinion 聚合评分。
   * @param workflowId 用于解析预设配置（含权重 + 阈值 + fallback 策略）。
   */
  async score(reviewId: string, workflowId: string): Promise<ScoringResult> {
    const config: WorkflowConfig = this.registry.resolve(workflowId);

    const opinions = await this.prisma.reviewOpinion.findMany({
      where: { reviewId },
      select: { dimension: true, riskLevel: true, confidenceScore: true },
    });

    // 按维度聚合
    const byDim = new Map<string, { confidences: number[]; risks: string[] }>();
    for (const o of opinions) {
      const dim = o.dimension || '未分类';
      if (!byDim.has(dim)) byDim.set(dim, { confidences: [], risks: [] });
      const entry = byDim.get(dim)!;
      entry.confidences.push(typeof o.confidenceScore === 'number' ? o.confidenceScore : 0);
      entry.risks.push((o.riskLevel || 'info').toLowerCase());
    }

    const presentDims = [...byDim.keys()];

    // 1) 解析每个维度的原始权重（显式 byDimension，否则留待 fallback）
    const explicitWeight = new Map<string, number>();
    let explicitSum = 0;
    for (const dim of presentDims) {
      const w = config.scoringWeights.byDimension[dim];
      if (typeof w === 'number') {
        explicitWeight.set(dim, w);
        explicitSum += w;
      }
    }

    // 2) fallback 维度分配剩余权重（1 - explicitSum）
    const fallbackDims = presentDims.filter((d) => !explicitWeight.has(d));
    const fallbackBudget = Math.max(0, 1 - explicitSum);
    const weights = new Map<string, number>(explicitWeight);
    if (fallbackDims.length > 0 && fallbackBudget > 0) {
      const shares = this.computeFallbackShares(fallbackDims, byDim, config.scoringWeights.fallback);
      for (const [dim, share] of shares) {
        weights.set(dim, share * fallbackBudget);
      }
    }

    // 3) 归一化所有权重到 Σ=1（保证 overallScore 落在 0–100 且 verdict 阈值语义正确）
    const totalWeight = [...weights.values()].reduce((a, b) => a + b, 0);
    if (totalWeight > 0) {
      for (const [dim, w] of weights) weights.set(dim, w / totalWeight);
    } else if (presentDims.length > 0) {
      // 极端兜底：无任何权重 → 均匀分配
      for (const dim of presentDims) weights.set(dim, 1 / presentDims.length);
    }

    // 4) 计算每维度 DimensionScore
    const dimensionScores: DimensionScore[] = presentDims.map((dim) => {
      const entry = byDim.get(dim)!;
      const confidenceAvg =
        entry.confidences.reduce((a, b) => a + b, 0) /
        Math.max(1, entry.confidences.length);
      const riskPenalty = riskPenaltyOf(entry.risks);
      const weight = weights.get(dim) ?? 0;
      const weightedScore = confidenceAvg * riskPenalty * weight;
      return {
        dimension: dim,
        weight: Number(weight.toFixed(4)),
        confidenceAvg: Number(confidenceAvg.toFixed(2)),
        riskPenalty,
        weightedScore: Number(weightedScore.toFixed(2)),
      };
    });

    const overallRaw = dimensionScores.reduce((a, d) => a + d.weightedScore, 0);
    const overallScore = Math.max(0, Math.min(100, Math.round(overallRaw)));

    const verdict = this.judgeVerdict(overallScore, config.verdictThresholds);

    // adoptionRate：沿用 P1 语义 —— 非 high-risk 意见视为"被保留"的比例（0–100）
    const total = opinions.length;
    const highRisk = opinions.filter((o) => (o.riskLevel || '').toLowerCase() === 'high').length;
    const adoptedRate = total > 0 ? Math.round(100 * (1 - highRisk / total)) : 0;

    const expected = Object.keys(config.scoringWeights.byDimension);
    const covered = presentDims;
    const missing = expected.filter((d) => !covered.includes(d));

    const resolvedWeights: Record<string, number> = {};
    for (const [dim, w] of weights) resolvedWeights[dim] = Number(w.toFixed(4));

    const result: ScoringResult = {
      workflowId: config.id,
      dimensionScores,
      overallScore,
      verdict,
      adoptedRate,
      coverage: { expected, covered, missing },
      configSnapshot: {
        weights: resolvedWeights,
        thresholds: {
          approved: config.verdictThresholds.approved,
          conditionallyApproved: config.verdictThresholds.conditionallyApproved,
        },
      },
    };

    this.logger.log(
      `Scored review=${reviewId.substring(0, 8)} workflow=${config.id} overall=${overallScore} verdict=${verdict}`,
    );
    return result;
  }

  /** verdict 阈值判定（Contract §4.4）。 */
  private judgeVerdict(
    overallScore: number,
    t: { approved: number; conditionallyApproved: number },
  ): Verdict {
    if (overallScore >= t.approved) return 'approved';
    if (overallScore >= t.conditionallyApproved) return 'conditionally_approved';
    return 'rejected';
  }

  /** fallback 权重分配（Contract §4.3）：返回每个 fallback 维度的归一化份额（Σ=1）。 */
  private computeFallbackShares(
    dims: string[],
    byDim: Map<string, { confidences: number[]; risks: string[] }>,
    strategy: 'uniform' | 'confidence' | 'risk',
  ): Array<[string, number]> {
    const raw = new Map<string, number>();
    if (strategy === 'uniform') {
      for (const d of dims) raw.set(d, 1);
    } else if (strategy === 'confidence') {
      for (const d of dims) {
        const e = byDim.get(d)!;
        const avg = e.confidences.reduce((a, b) => a + b, 0) / Math.max(1, e.confidences.length);
        raw.set(d, Math.max(0, avg));
      }
    } else {
      // risk：权重 ∝ 最高 riskLevel 严重度（high=3 / medium=2 / low=1）
      for (const d of dims) {
        const e = byDim.get(d)!;
        let sev = 0;
        for (const r of e.risks) sev = Math.max(sev, RISK_SEVERITY[(r || 'info').toLowerCase()] ?? 0);
        raw.set(d, sev <= 0 ? 1 : sev);
      }
    }
    const sum = [...raw.values()].reduce((a, b) => a + b, 0);
    if (sum <= 0) {
      for (const d of dims) raw.set(d, 1);
    }
    const total = [...raw.values()].reduce((a, b) => a + b, 0);
    return dims.map((d) => [d, (raw.get(d) ?? 0) / total]);
  }

  /** 评分结果持久化到 Review 表（审计快照，Contract §5 / §7.3 红线）。 */
  async saveScoringResult(reviewId: string, result: ScoringResult): Promise<void> {
    await this.prisma.review.update({
      where: { id: reviewId },
      data: { scoringConfig: result as unknown as object },
    });
  }

  /** 读取历史评分配置快照（scoringConfig 列）。 */
  async getScoringSnapshot(reviewId: string): Promise<ScoringResult | null> {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      select: { scoringConfig: true },
    });
    const cfg = review?.scoringConfig;
    if (!cfg) return null;
    return cfg as unknown as ScoringResult;
  }
}
