/**
 * T11 (Sprint 11.0) — 会话级隔离（并发评审无串场）。
 *
 * 架构审计结论：编排内存态（runningReviews / interruptTimers）按 reviewId 键控；
 * usage/opinions 全部从 DB 聚合（buildState），服务层（Moderator/ScoringPass/Lifecycle）无共享可变状态；
 * queue.processedIds 按 jobId（含 reviewId）去重，终态 cleanupReview 按 reviewId 清扫。
 * 本测试用共享 mock prisma（按 reviewId 过滤）+ 并发调用验证无串场。
 */
import { MockModerator } from '../modules/reviews/orchestrator/moderator';
import { ScoringPassService } from '../modules/reviews/scoring/scoring-pass';
import { WorkflowRegistry } from '../modules/workflow/workflow.registry';
import { ReviewState } from '../modules/reviews/orchestrator/graph-runtime';
import type { WorkflowConfig } from '../modules/workflow/workflow.registry';

const GATES = { maxRounds: 3, maxTurnsPerReviewer: 3, minRounds: 1, maxTokensPerReview: 200_000, maxCostPerReview: 0 };
const CONFIG: WorkflowConfig = {
  id: 'enterprise', nameZh: '企业评审', description: 'test',
  maxRounds: 3, minRounds: 1, debateAfterRound: 2, turnPhasePattern: ['round_robin'],
  availableTools: [], scoringWeights: { byDimension: {} } as any, verdictThresholds: {} as any,
};

interface MockOpinion { id: string; turnId: string; reviewId: string; dimension: string; riskLevel: string; stance?: string | null; dedupKey?: string | null; confidenceScore?: number; score?: number | null; status?: string | null; issue?: string }
interface MockTurn { id: string; reviewId: string; round: number }

/** 按 reviewId 隔离的共享 mock prisma（并发下验证无串场）。 */
function makeIsolatedPrisma(data: Record<string, { turns: MockTurn[]; opinions: MockOpinion[] }>) {
  const auditCalls: any[] = [];
  const prisma = {
    reviewOpinion: {
      findMany: jest.fn(async ({ where }: any) => {
        const all = Object.values(data).flatMap((d) => d.opinions);
        if (where?.turnId?.in) {
          const turnIds = new Set(where.turnId.in as string[]);
          return all.filter((o) => turnIds.has(o.turnId));
        }
        if (where?.reviewId) return data[where.reviewId]?.opinions ?? [];
        return all;
      }),
      update: jest.fn(async ({ where, data: d }: any) => {
        const all = Object.values(data).flatMap((d2) => d2.opinions);
        const o = all.find((x) => x.id === where.id);
        if (o) Object.assign(o, d);
        return o;
      }),
    },
    reviewTurn: {
      findMany: jest.fn(async ({ where }: any) => {
        if (where?.reviewId) return data[where.reviewId]?.turns ?? [];
        return Object.values(data).flatMap((d) => d.turns);
      }),
    },
    review: {
      findUnique: jest.fn(async ({ where }: any) => ({
        mode: 'enterprise',
        tenantId: 't1',
        ...(where?.id ? { id: where.id } : {}),
      })),
    },
    moderatorDecision: { create: jest.fn().mockResolvedValue({ id: 'dec', createdAt: new Date() }) },
    $transaction: async (fn: any) => fn(prisma),
  };
  const audit = { log: jest.fn(async (input: any) => auditCalls.push(input)) };
  return { prisma: prisma as any, audit, auditCalls };
}

function state(reviewId: string, round: number): ReviewState {
  return {
    reviewId, status: 'running', round, currentNodeId: 'running',
    turns: [], moderatorDecisions: [],
    usage: { totalRounds: round, totalTokens: 100, totalCost: 0, turnsByReviewer: { rv1: 1 } },
    updatedAt: new Date().toISOString(),
  };
}

describe('T11 — 并发评审会话隔离', () => {
  it('5 场并发 MockModerator.decide 各自使用本场意见（无串场）', async () => {
    const data = {
      'r-agree': { turns: [{ id: 'ta1', reviewId: 'r-agree', round: 2 }], opinions: [{ id: 'oa1', turnId: 'ta1', reviewId: 'r-agree', dimension: '架构', riskLevel: 'high', stance: 'agree', confidenceScore: 80, status: 'candidate' }] },
      'r-escalate': { turns: [{ id: 'te1', reviewId: 'r-escalate', round: 2 }, { id: 'te2', reviewId: 'r-escalate', round: 2 }], opinions: [{ id: 'oe1', turnId: 'te1', reviewId: 'r-escalate', dimension: '架构', riskLevel: 'high', confidenceScore: 80, status: 'candidate' }, { id: 'oe2', turnId: 'te2', reviewId: 'r-escalate', dimension: '安全', riskLevel: 'high', confidenceScore: 80, status: 'candidate' }] },
      'r-gate': { turns: [{ id: 'tg1', reviewId: 'r-gate', round: 1 }], opinions: [{ id: 'og1', turnId: 'tg1', reviewId: 'r-gate', dimension: '架构', riskLevel: 'high', confidenceScore: 40, status: 'candidate' }] },
      'r-quiet': { turns: [{ id: 'tq1', reviewId: 'r-quiet', round: 1 }], opinions: [{ id: 'oq1', turnId: 'tq1', reviewId: 'r-quiet', dimension: '架构', riskLevel: 'low', confidenceScore: 80, status: 'candidate' }] },
      'r-empty': { turns: [], opinions: [] },
    };
    const { prisma } = makeIsolatedPrisma(data);
    const moderator = new MockModerator(prisma);

    const results = await Promise.all([
      moderator.decide(state('r-agree', 2), GATES, CONFIG),
      moderator.decide(state('r-escalate', 2), GATES, CONFIG),
      moderator.decide(state('r-gate', 1), GATES, CONFIG),
      moderator.decide(state('r-quiet', 1), GATES, CONFIG),
      moderator.decide(state('r-empty', 1), GATES, CONFIG),
    ]);

    const byReview = new Map(results.map((r) => [r.reviewId, r.decisionType]));
    expect(byReview.get('r-agree')).toBe('converge'); // 全员 agree + 高置信度
    expect(byReview.get('r-escalate')).toBe('escalate'); // round2 未收敛 → 扩容
    expect(byReview.get('r-gate')).toBe('risk_gate_hitel'); // 高风险低置信度
    expect(byReview.get('r-quiet')).toBe('converge'); // 低风险
    expect(byReview.get('r-empty')).toBe('converge'); // 无意见
    // 关键：5 场互不污染（escalate 场不会带上 r-agree 的 agree 信号）
    expect(results.find((r) => r.reviewId === 'r-escalate')!.ruleCheckResult.allAgreeOk).toBe(false);
    expect(results.find((r) => r.reviewId === 'r-agree')!.ruleCheckResult.allAgreeOk).toBe(true);
  });

  it('5 场并发 ScoringPass.run 各自写入本场维度分（无串场）', async () => {
    const data = {
      'r1': { turns: [{ id: 't1', reviewId: 'r1', round: 1 }], opinions: [{ id: 'o1', turnId: 't1', reviewId: 'r1', dimension: '架构', riskLevel: 'high', status: 'candidate' }] },
      'r2': { turns: [{ id: 't1', reviewId: 'r2', round: 1 }], opinions: [{ id: 'o2', turnId: 't1', reviewId: 'r2', dimension: '安全', riskLevel: 'low', status: 'candidate' }] },
    };
    const { prisma } = makeIsolatedPrisma(data);
    const svc = new ScoringPassService(prisma, { log: jest.fn() } as any, new WorkflowRegistry());

    const results = await Promise.all([svc.run('r1'), svc.run('r2')]);
    expect(results[0].dimensions).toEqual(['架构']);
    expect(results[1].dimensions).toEqual(['安全']);
    // 各场意见只被本场写入 score（r1 的 o1 得 43=55-12，r2 的 o2 得 59=55+4）
    const o1 = data['r1'].opinions[0] as any;
    const o2 = data['r2'].opinions[0] as any;
    expect(o1.score).toBe(43);
    expect(o2.score).toBe(59);
    expect(o1.score).not.toBe(o2.score); // 无串场
  });
});
