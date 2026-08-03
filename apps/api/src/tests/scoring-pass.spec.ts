/**
 * T4 (Sprint 11.0) — Scoring pass: observation/judgment separation.
 *
 * Scope:
 *  - computeDimensionScores（mock 确定性公式：锚定 + 风险微调 + clamp）
 *  - ScoringPassService.run（写 score / 跳过 rejected / 审计）
 *  - ScoringService 聚合：score 优先于 reviewer confidenceScore
 *  - validateOpinion：confidenceScore 可选 + score 校验
 */
import {
  computeDimensionScores,
  ScoringPassService,
} from '../modules/reviews/scoring/scoring-pass';
import { ScoringService } from '../modules/reviews/scoring/scoring.service';
import { WorkflowRegistry } from '../modules/workflow/workflow.registry';
import { validateOpinion } from '../modules/reviews/orchestrator/opinion';
import { isReportable } from '../modules/reviews/orchestrator/opinion-lifecycle';

// ── computeDimensionScores ───────────────────────────────────

describe('computeDimensionScores', () => {
  it('returns empty map for no opinions', () => {
    expect(computeDimensionScores([], { defaultAnchor: 55 })).toEqual({});
  });

  it('applies risk adjustments around the default anchor', () => {
    const scores = computeDimensionScores(
      [
        { id: 'o1', dimension: '架构合理性', riskLevel: 'high' },
        { id: 'o2', dimension: '投入产出分析', riskLevel: 'low' },
        { id: 'o3', dimension: '交付风险', riskLevel: 'medium' },
        { id: 'o4', dimension: '用户体验', riskLevel: 'info' },
      ],
      { defaultAnchor: 55 },
    );
    expect(scores['架构合理性']).toBe(43); // 55 - 12
    expect(scores['投入产出分析']).toBe(59); // 55 + 4
    expect(scores['交付风险']).toBe(50); // 55 - 5
    expect(scores['用户体验']).toBe(63); // 55 + 8
  });

  it('aggregates multiple opinions in one dimension', () => {
    const scores = computeDimensionScores(
      [
        { id: 'o1', dimension: '架构合理性', riskLevel: 'high' },
        { id: 'o2', dimension: '架构合理性', riskLevel: 'high' },
      ],
      { defaultAnchor: 55 },
    );
    expect(scores['架构合理性']).toBe(31); // 55 - 24
  });

  it('clamps to [0,100]', () => {
    const low = computeDimensionScores([{ id: 'o1', dimension: 'D', riskLevel: 'high' }], { defaultAnchor: 0 });
    const high = computeDimensionScores([{ id: 'o1', dimension: 'D', riskLevel: 'info' }], { defaultAnchor: 100 });
    expect(low['D']).toBe(0);
    expect(high['D']).toBe(100);
  });
});

// ── ScoringPassService.run ────────────────────────────────────

interface PassOpinion { id: string; dimension: string; riskLevel: string; status: string | null; score?: number }
function passService(opinions: PassOpinion[]) {
  const rows: PassOpinion[] = opinions.map((o) => ({ ...o }));
  const auditCalls: any[] = [];
  const prisma = {
    review: { findUnique: jest.fn().mockResolvedValue({ mode: 'enterprise', tenantId: 't1' }) },
    reviewOpinion: {
      findMany: jest.fn().mockResolvedValue(rows),
      update: jest.fn(async ({ where, data }: any) => {
        const r = rows.find((x) => x.id === where.id);
        if (r) Object.assign(r, data);
        return r;
      }),
    },
    $transaction: async (fn: any) => fn(prisma),
  } as any;
  const audit = { log: jest.fn(async (input: any) => auditCalls.push(input)) };
  const service = new ScoringPassService(prisma, audit as any, new WorkflowRegistry());
  return { service, rows, auditCalls };
}

describe('ScoringPassService.run', () => {
  it('writes dimension scores to reportable opinions and audits', async () => {
    const { service, rows, auditCalls } = passService([
      { id: 'o1', dimension: '架构合理性', riskLevel: 'high', status: 'candidate' },
      { id: 'o2', dimension: '投入产出分析', riskLevel: 'low', status: 'candidate' },
      { id: 'o3', dimension: '交付风险', riskLevel: 'medium', status: 'rejected' },
    ]);
    const result = await service.run('r1', { tenantId: 't1', userId: 'u1' });
    expect(result.scored).toBe(2); // rejected 跳过
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get('o1')!.score).toBe(43); // 55 - 12
    expect(byId.get('o2')!.score).toBe(59); // 55 + 4
    expect(byId.get('o3')!.score).toBeUndefined(); // rejected 不评分
    expect(auditCalls.some((c) => c.action === 'review.scoring_pass.run')).toBe(true);
  });

  it('no-op when review has no reportable opinions', async () => {
    const { service } = passService([
      { id: 'o1', dimension: 'D', riskLevel: 'high', status: 'rejected' },
    ]);
    const result = await service.run('r1');
    expect(result).toEqual({ scored: 0, dimensions: [] });
  });
});

// ── ScoringService：score 优先于 confidenceScore ──────────────

function scoreService(opinions: Array<{ dimension: string; riskLevel: string; confidenceScore: number; score?: number | null; status?: string | null }>) {
  const prisma = {
    reviewOpinion: { findMany: jest.fn().mockResolvedValue(opinions) },
  } as any;
  return new ScoringService(prisma, new WorkflowRegistry());
}

describe('ScoringService — effective score (T4)', () => {
  it('uses score from scoring pass when present', async () => {
    const svc = scoreService([
      { dimension: '架构合理性', riskLevel: 'low', confidenceScore: 90, score: 43, status: 'candidate' },
    ]);
    const result = await svc.score('r1', 'enterprise');
    expect(result.distribution.mean).toBe(43);
    expect(result.dimensionScores.find((d) => d.dimension === '架构合理性')!.confidenceAvg).toBe(43);
  });

  it('falls back to reviewer confidenceScore when score is null', async () => {
    const svc = scoreService([
      { dimension: '架构合理性', riskLevel: 'low', confidenceScore: 78, score: null, status: 'candidate' },
    ]);
    const result = await svc.score('r1', 'enterprise');
    expect(result.distribution.mean).toBe(78);
  });
});

// ── validateOpinion：confidenceScore 可选 + score 校验 ────────

describe('validateOpinion — T4 optional confidenceScore / score', () => {
  const base = { schemaVersion: '1.0', dimension: 'd', riskLevel: 'high' as const, issue: 'i', recommendation: 'r', citations: [] as string[] };

  it('accepts an observation without confidenceScore', () => {
    const r = validateOpinion({ ...base });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('accepts valid score and rejects out-of-range score', () => {
    expect(validateOpinion({ ...base, score: 55 }).valid).toBe(true);
    expect(validateOpinion({ ...base, score: 101 } as any).valid).toBe(false);
    expect(validateOpinion({ ...base, score: 50.5 } as any).valid).toBe(false);
  });
});

// ── isReportable（scoring pass 只评 reportable）───────────────

describe('isReportable — scoring pass input filter', () => {
  it('excludes rejected only', () => {
    expect(isReportable('candidate')).toBe(true);
    expect(isReportable('accepted')).toBe(true);
    expect(isReportable('downgraded')).toBe(true);
    expect(isReportable('rejected')).toBe(false);
  });
});
