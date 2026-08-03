/**
 * T3 (Sprint 11.0) — Score discipline: distribution + inflation detection + prompt injection.
 *
 * Scope:
 *  - computeScoreDistribution（纯函数：mean/stddev/above70Pct）
 *  - Workflow preset 的 scoreDiscipline 配置 + DEFAULT + validateCustom
 *  - ScoringService.score() 通胀检测（inflationWarning / distribution / snapshot）
 *  - buildScoreDisciplineText（prompt 注入文本）
 */
import {
  computeScoreDistribution,
  ScoringService,
  ScoreDistribution,
} from '../modules/reviews/scoring/scoring.service';
import {
  WorkflowRegistry,
  DEFAULT_SCORE_DISCIPLINE,
  PRESET_WORKFLOWS,
  WorkflowId,
} from '../modules/workflow/workflow.registry';
import { buildScoreDisciplineText } from '../modules/reviews/provider/model-adapter';

// ── computeScoreDistribution ──────────────────────────────────

describe('computeScoreDistribution', () => {
  it('returns zeros for empty input', () => {
    expect(computeScoreDistribution([])).toEqual({ mean: 0, stddev: 0, above70Pct: 0, count: 0 });
  });

  it('computes mean/stddev/above70Pct correctly', () => {
    const d = computeScoreDistribution([50, 60, 70]);
    expect(d.count).toBe(3);
    expect(d.mean).toBe(60);
    expect(d.stddev).toBeCloseTo(8.16, 1);
    expect(d.above70Pct).toBe(0); // 70 不算 >70
  });

  it('above70Pct counts strictly greater than 70', () => {
    const d = computeScoreDistribution([80, 90, 50]);
    expect(d.above70Pct).toBeCloseTo(2 / 3, 4);
  });

  it('ignores non-finite values', () => {
    const d = computeScoreDistribution([80, NaN, 70] as number[]);
    expect(d.count).toBe(2);
  });
});

// ── Workflow preset 配置 ──────────────────────────────────────

describe('Workflow scoreDiscipline presets', () => {
  it('all 4 presets carry scoreDiscipline', () => {
    for (const id of Object.keys(PRESET_WORKFLOWS) as WorkflowId[]) {
      expect(PRESET_WORKFLOWS[id].scoreDiscipline).toBeDefined();
    }
  });

  it('enterprise default anchor = 55, maxAbove70Pct = 0.3', () => {
    const d = PRESET_WORKFLOWS.enterprise.scoreDiscipline!;
    expect(d.defaultAnchor).toBe(55);
    expect(d.maxAbove70Pct).toBe(0.3);
    expect(d.requireJustificationAbove70).toBe(true);
  });

  it('DEFAULT_SCORE_DISCIPLINE matches enterprise', () => {
    expect(DEFAULT_SCORE_DISCIPLINE).toEqual(PRESET_WORKFLOWS.enterprise.scoreDiscipline);
  });

  it('registry.resolve returns preset discipline for unknown → enterprise fallback', () => {
    const registry = new WorkflowRegistry();
    expect(registry.resolve('unknown').scoreDiscipline?.defaultAnchor).toBe(55);
  });
});

describe('validateCustom — scoreDiscipline', () => {
  const registry = new WorkflowRegistry();

  it('accepts valid discipline', () => {
    const r = registry.validateCustom({
      scoringWeights: { byDimension: { A: 1 }, fallback: 'uniform' },
      verdictThresholds: { approved: 75, conditionallyApproved: 50 },
      scoreDiscipline: { defaultAnchor: 55, maxAbove70Pct: 0.3, requireJustificationAbove70: true },
    } as any);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects out-of-range defaultAnchor / maxAbove70Pct / non-boolean', () => {
    const r = registry.validateCustom({
      scoringWeights: { byDimension: { A: 1 }, fallback: 'uniform' },
      scoreDiscipline: { defaultAnchor: 120, maxAbove70Pct: 2, requireJustificationAbove70: 'yes' as any },
    } as any);
    expect(r.ok).toBe(false);
    expect(r.errors.join('|')).toContain('defaultAnchor');
    expect(r.errors.join('|')).toContain('maxAbove70Pct');
    expect(r.errors.join('|')).toContain('requireJustificationAbove70');
  });
});

// ── ScoringService 通胀检测 ───────────────────────────────────

function scoreService(opinions: Array<{ dimension: string; riskLevel: string; confidenceScore: number; status?: string | null }>) {
  const prisma = {
    reviewOpinion: { findMany: jest.fn().mockResolvedValue(opinions) },
  } as any;
  const registry = new WorkflowRegistry();
  return new ScoringService(prisma, registry);
}

describe('ScoringService — inflation detection (T3)', () => {
  it('flags inflationWarning when above70Pct exceeds workflow maxAbove70Pct', async () => {
    const svc = scoreService([
      { dimension: '架构合理性', riskLevel: 'low', confidenceScore: 90, status: 'candidate' },
      { dimension: '投入产出分析', riskLevel: 'low', confidenceScore: 85, status: 'candidate' },
      { dimension: '交付风险', riskLevel: 'medium', confidenceScore: 55, status: 'candidate' },
    ]);
    const result = await svc.score('r1', 'enterprise'); // maxAbove70Pct=0.3, above70=2/3
    expect(result.inflationWarning).toBe(true);
    expect(result.distribution.above70Pct).toBeCloseTo(2 / 3, 4);
    expect(result.distribution.count).toBe(3);
    expect(result.configSnapshot.scoreDiscipline.defaultAnchor).toBe(55);
  });

  it('no inflation when within limit', async () => {
    const svc = scoreService([
      { dimension: '架构合理性', riskLevel: 'low', confidenceScore: 60, status: 'accepted' },
      { dimension: '投入产出分析', riskLevel: 'low', confidenceScore: 55, status: 'accepted' },
    ]);
    const result = await svc.score('r1', 'enterprise');
    expect(result.inflationWarning).toBe(false);
    expect(result.distribution.above70Pct).toBe(0);
  });

  it('rejected opinions are excluded from distribution (T1 口径)', async () => {
    const svc = scoreService([
      { dimension: '架构合理性', riskLevel: 'low', confidenceScore: 95, status: 'accepted' },
      { dimension: '投入产出分析', riskLevel: 'low', confidenceScore: 90, status: 'rejected' }, // duplicate（不计入）
    ]);
    const result = await svc.score('r1', 'enterprise');
    expect(result.distribution.count).toBe(1); // rejected 被排除
    expect(result.distribution.above70Pct).toBe(1); // 仅剩 1 条且 >70
    expect(result.inflationWarning).toBe(true); // 1/1 > 0.3 → 通胀
  });
});

// ── buildScoreDisciplineText（prompt 注入）────────────────────

describe('buildScoreDisciplineText', () => {
  it('zh text contains anchor and justification requirement', () => {
    const t = buildScoreDisciplineText({ defaultAnchor: 55, requireJustificationAbove70: true }, true);
    expect(t).toContain('55/100');
    expect(t).toContain('70/100');
  });

  it('en text contains anchor', () => {
    const t = buildScoreDisciplineText({ defaultAnchor: 60, requireJustificationAbove70: true }, false);
    expect(t).toContain('60/100');
    expect(t).toContain('explicit justification');
  });

  it('omits justification line when requireJustificationAbove70=false', () => {
    const t = buildScoreDisciplineText({ defaultAnchor: 55, requireJustificationAbove70: false }, true);
    expect(t).not.toContain('必须附明确论证');
  });
});
