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
import { WorkflowRegistry, WorkflowConfig, WorkflowId, DEFAULT_SCORE_DISCIPLINE } from '../../workflow/workflow.registry';
import type { ScoreDiscipline } from '../../workflow/workflow.registry';
import { isReportable } from '../orchestrator/opinion-lifecycle';

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
  readonly scoreDiscipline: ScoreDiscipline; // T3：评分纪律快照（通胀判定可回放）
}

/** T3 (Sprint 11.0) 评分分布：基于 reportable 意见的 confidenceScore 统计（防通胀检测输入）。 */
export interface ScoreDistribution {
  readonly mean: number;       // 均值（0–100）
  readonly stddev: number;     // 标准差
  readonly above70Pct: number; // >70 分意见占比（0~1）
  readonly count: number;      // 参与统计的意见数
}

/** 纯函数：计算分布。空数组 → 全 0。 */
export function computeScoreDistribution(scores: readonly number[]): ScoreDistribution {
  const valid = scores.filter((s) => typeof s === 'number' && Number.isFinite(s));
  if (valid.length === 0) return { mean: 0, stddev: 0, above70Pct: 0, count: 0 };
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  const variance =
    valid.reduce((a, b) => a + (b - mean) * (b - mean), 0) / valid.length;
  const above70Pct = valid.filter((s) => s > 70).length / valid.length;
  return {
    mean: Number(mean.toFixed(2)),
    stddev: Number(Math.sqrt(variance).toFixed(2)),
    above70Pct: Number(above70Pct.toFixed(4)),
    count: valid.length,
  };
}

export interface ScoringResult {
  readonly workflowId: WorkflowId;
  readonly dimensionScores: DimensionScore[];
  readonly overallScore: number; // 加权总分 0–100 整数
  readonly verdict: Verdict;
  readonly adoptedRate: number; // recommendation 类意见被保留比例（0–100）
  readonly coverage: ScoringCoverage;
  readonly configSnapshot: ScoringConfigSnapshot; // 审计快照
  // --- T3 (Sprint 11.0) 评分纪律：分布 + 通胀检测 ---
  readonly distribution: ScoreDistribution;
  readonly inflationWarning: boolean; // above70Pct 超限 → true（不阻断，仅提示 + 审计）
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
      select: { dimension: true, riskLevel: true, confidenceScore: true, status: true },
    });
    // T1 (Sprint 11.0)：评分只统计 reportable 意见（accepted/downgraded/candidate；rejected 重复/失败存根不计分，防通胀）
    const reportableOpinions = opinions.filter((o) => isReportable(o.status));

    // 按维度聚合
    const byDim = new Map<string, { confidences: number[]; risks: string[] }>();
    for (const o of reportableOpinions) {
      const dim = o.dimension || '未分类';
      if (!byDim.has(dim)) byDim.set(dim, { confidences: [], risks: [] });
      const entry = byDim.get(dim)!;
      entry.confidences.push(typeof o.confidenceScore === 'number' ? o.confidenceScore : 0);
      entry.risks.push((o.riskLevel || 'info').toLowerCase());
    }

    // T3 (Sprint 11.0)：评分分布 + 通胀检测（基于 reportable 意见 confidenceScore）
    const discipline = config.scoreDiscipline ?? DEFAULT_SCORE_DISCIPLINE;
    const distribution = computeScoreDistribution(
      reportableOpinions.map((o) => (typeof o.confidenceScore === 'number' ? o.confidenceScore : 0)),
    );
    const inflationWarning =
      distribution.count > 0 && distribution.above70Pct > discipline.maxAbove70Pct;

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
        scoreDiscipline: discipline, // T3：审计快照含评分纪律（可回放通胀判定）
      },
      distribution,
      inflationWarning,
    };

    this.logger.log(
      `Scored review=${reviewId.substring(0, 8)} workflow=${config.id} overall=${overallScore} verdict=${verdict}` +
        (inflationWarning ? ` INFLATION(>70=${(distribution.above70Pct * 100).toFixed(1)}% > ${(discipline.maxAbove70Pct * 100).toFixed(1)}%)` : ''),
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
