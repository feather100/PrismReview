/**
 * T2 (Sprint 11.0) — Convergence signals: 全员 AGREE / no-new-arguments / maxRounds 硬闸.
 *
 * Scope:
 *  - computeRuleCheck 收敛语义（round-1 兼容旧启发式；round≥2 用显式信号）
 *  - loadRoundEvidence（stance → allAgree；dedupKey 重叠 → noNewArguments）
 *  - MockModerator.decide 三选一触发
 *  - normalizeStance / validateOpinion stance 校验
 */
import {
  computeRuleCheck,
  loadRoundEvidence,
  MockModerator,
  DEFAULT_HARD_GATES,
  HardGates,
  ConvergenceSignals,
} from '../modules/reviews/orchestrator/moderator';
import { ReviewState } from '../modules/reviews/orchestrator/graph-runtime';
import { normalizeStance, validateOpinion } from '../modules/reviews/orchestrator/opinion';
import type { WorkflowConfig } from '../modules/workflow/workflow.registry';

const GATES: HardGates = { maxRounds: 3, maxTurnsPerReviewer: 3, minRounds: 1, maxTokensPerReview: 200_000, maxCostPerReview: 0 };

function state(round: number, usage: Partial<ReviewState['usage']> = {}): ReviewState {
  return {
    reviewId: 'test-review',
    status: 'running',
    round,
    currentNodeId: 'running',
    turns: [],
    moderatorDecisions: [],
    usage: { totalRounds: round, totalTokens: 0, totalCost: 0, turnsByReviewer: { rv1: 1, rv2: 1 }, ...usage },
    updatedAt: new Date().toISOString(),
  };
}

const CONFIG: WorkflowConfig = {
  id: 'enterprise', nameZh: '企业评审', description: 'test',
  maxRounds: 3, minRounds: 1, debateAfterRound: 2, turnPhasePattern: ['round_robin'],
  availableTools: [], scoringWeights: { byDimension: {} } as any, verdictThresholds: {} as any,
};

// ── computeRuleCheck 收敛语义 ─────────────────────────────────

describe('computeRuleCheck — T2 convergence semantics', () => {
  it('keeps legacy reviewersSpoke heuristic when no signals passed (backward compat)', () => {
    const r = computeRuleCheck(state(2), GATES);
    expect(r.convergenceOk).toBe(true);
    expect(r.allAgreeOk).toBe(false);
    expect(r.noNewArgumentsOk).toBe(false);
    expect(r.passed).toBe(true);
  });

  it('ignores signals at round 1 (single-round baseline converges on speak)', () => {
    const r = computeRuleCheck(state(1), GATES, { allAgree: true, noNewArguments: true });
    expect(r.allAgreeOk).toBe(true);
    expect(r.convergenceOk).toBe(true); // round<2 → reviewersSpoke
  });

  it('round>=2: converges when allAgree', () => {
    const r = computeRuleCheck(state(2), GATES, { allAgree: true, noNewArguments: false });
    expect(r.allAgreeOk).toBe(true);
    expect(r.convergenceOk).toBe(true);
    expect(r.passed).toBe(true);
  });

  it('round>=2: converges when noNewArguments', () => {
    const r = computeRuleCheck(state(2), GATES, { allAgree: false, noNewArguments: true });
    expect(r.noNewArgumentsOk).toBe(true);
    expect(r.convergenceOk).toBe(true);
  });

  it('round>=2: NOT converged when neither signal', () => {
    const r = computeRuleCheck(state(2), GATES, { allAgree: false, noNewArguments: false });
    expect(r.convergenceOk).toBe(false);
    expect(r.passed).toBe(false);
  });
});

// ── loadRoundEvidence ─────────────────────────────────────────

function evidencePrisma(options: {
  currentTurns: Array<{ id: string }>;
  currentOpinions: Array<{ riskLevel?: string; stance?: string | null; dedupKey?: string | null }>;
  prevTurns?: Array<{ id: string }>;
  prevOpinions?: Array<{ dedupKey?: string | null }>;
}) {
  const { currentTurns, currentOpinions, prevTurns = [], prevOpinions = [] } = options;
  return {
    reviewTurn: {
      findMany: jest.fn(({ where }: any) => {
        if (where?.round && typeof where.round === 'object' && where.round.lt !== undefined) return Promise.resolve(prevTurns);
        return Promise.resolve(currentTurns);
      }),
    },
    reviewOpinion: {
      findMany: jest.fn(({ where }: any) => {
        if (where?.turnId?.in && prevTurns.some((t) => where.turnId.in.includes(t.id))) {
          return Promise.resolve(prevOpinions);
        }
        return Promise.resolve(currentOpinions);
      }),
    },
  } as any;
}

describe('loadRoundEvidence', () => {
  it('allAgree=true when every current opinion stance=agree', async () => {
    const prisma = evidencePrisma({ currentTurns: [{ id: 't1' }, { id: 't2' }], currentOpinions: [{ stance: 'agree' }, { stance: 'agree' }] });
    const ev = await loadRoundEvidence(prisma, 'r1', 2);
    expect(ev.allAgree).toBe(true);
    expect(ev.highRiskCount).toBe(0);
    expect(ev.noNewArguments).toBe(false);
  });

  it('allAgree=false when any stance is not agree (incl. null → neutral)', async () => {
    const prisma = evidencePrisma({ currentTurns: [{ id: 't1' }, { id: 't2' }], currentOpinions: [{ stance: 'agree' }, { stance: null }] });
    const ev = await loadRoundEvidence(prisma, 'r1', 2);
    expect(ev.allAgree).toBe(false);
  });

  it('noNewArguments=true when all current dedupKeys already seen in earlier rounds', async () => {
    const prisma = evidencePrisma({
      currentTurns: [{ id: 't3' }, { id: 't4' }],
      currentOpinions: [{ dedupKey: 'k1' }, { dedupKey: 'k2' }],
      prevTurns: [{ id: 't1' }, { id: 't2' }],
      prevOpinions: [{ dedupKey: 'k1' }, { dedupKey: 'k2' }],
    });
    const ev = await loadRoundEvidence(prisma, 'r1', 2);
    expect(ev.noNewArguments).toBe(true);
  });

  it('noNewArguments=false when a genuinely new key appears', async () => {
    const prisma = evidencePrisma({
      currentTurns: [{ id: 't3' }],
      currentOpinions: [{ dedupKey: 'k-new' }],
      prevTurns: [{ id: 't1' }],
      prevOpinions: [{ dedupKey: 'k1' }],
    });
    const ev = await loadRoundEvidence(prisma, 'r1', 2);
    expect(ev.noNewArguments).toBe(false);
  });

  it('noNewArguments=false when keys are empty (conservative, legacy data)', async () => {
    const prisma = evidencePrisma({ currentTurns: [{ id: 't3' }], currentOpinions: [{ dedupKey: null }, { dedupKey: '' }] });
    const ev = await loadRoundEvidence(prisma, 'r1', 2);
    expect(ev.noNewArguments).toBe(false);
    expect(ev.allAgree).toBe(false);
  });

  it('returns empty evidence when no turns in current round', async () => {
    const prisma = evidencePrisma({ currentTurns: [], currentOpinions: [] });
    const ev = await loadRoundEvidence(prisma, 'r1', 2);
    expect(ev).toEqual({ highRiskCount: 0, allAgree: false, noNewArguments: false });
  });
});

// ── MockModerator.decide 三选一 ──────────────────────────────

function decidePrisma(options: {
  currentTurns: Array<{ id: string }>;
  currentOpinions: Array<{ riskLevel?: string; stance?: string | null; dedupKey?: string | null }>;
  prevTurns?: Array<{ id: string }>;
  prevOpinions?: Array<{ dedupKey?: string | null }>;
}) {
  const base = evidencePrisma(options);
  return {
    ...base,
    moderatorDecision: { create: jest.fn().mockResolvedValue({ id: 'dec-1', createdAt: new Date() }) },
  } as any;
}

describe('MockModerator.decide — T2 convergence', () => {
  it('round-2 全员 AGREE → converge（即使存在 high-risk 冲突）', async () => {
    const prisma = decidePrisma({
      currentTurns: [{ id: 't1' }, { id: 't2' }],
      currentOpinions: [{ riskLevel: 'high', stance: 'agree' }, { riskLevel: 'high', stance: 'agree' }],
      prevTurns: [], prevOpinions: [],
    });
    const d = await new MockModerator(prisma).decide(state(2), GATES, CONFIG);
    expect(d.decisionType).toBe('converge');
    expect(d.ruleCheckResult.allAgreeOk).toBe(true);
  });

  it('round-2 无新论点（dedup 重叠）→ converge', async () => {
    const prisma = decidePrisma({
      currentTurns: [{ id: 't3' }],
      currentOpinions: [{ riskLevel: 'medium', stance: 'neutral', dedupKey: 'k1' }],
      prevTurns: [{ id: 't1' }],
      prevOpinions: [{ dedupKey: 'k1' }],
    });
    const d = await new MockModerator(prisma).decide(state(2), GATES, CONFIG);
    expect(d.decisionType).toBe('converge');
    expect(d.ruleCheckResult.noNewArgumentsOk).toBe(true);
  });

  it('round-2 无信号 + 冲突 → continue_debate', async () => {
    const prisma = decidePrisma({
      currentTurns: [{ id: 't1' }, { id: 't2' }],
      currentOpinions: [
        { riskLevel: 'high', stance: 'neutral', dedupKey: 'new1' },
        { riskLevel: 'high', stance: 'neutral', dedupKey: 'new2' },
      ],
      prevTurns: [], prevOpinions: [],
    });
    const d = await new MockModerator(prisma).decide(state(2), GATES, CONFIG);
    expect(d.decisionType).toBe('continue_debate');
  });

  it('round-1 仍按旧启发式收敛（无冲突）', async () => {
    const prisma = decidePrisma({ currentTurns: [{ id: 't1' }], currentOpinions: [{ riskLevel: 'low' }] });
    const d = await new MockModerator(prisma).decide(state(1), GATES, CONFIG);
    expect(d.decisionType).toBe('converge');
  });
});

// ── normalizeStance / validateOpinion ────────────────────────

describe('normalizeStance / validateOpinion stance', () => {
  it('normalizes stance case-insensitively, defaults to neutral', () => {
    expect(normalizeStance('Agree')).toBe('agree');
    expect(normalizeStance('DISAGREE')).toBe('disagree');
    expect(normalizeStance('')).toBe('neutral');
    expect(normalizeStance(undefined)).toBe('neutral');
    expect(normalizeStance('bogus')).toBe('neutral');
  });

  it('validateOpinion accepts valid stance and rejects invalid', () => {
    expect(validateOpinion({ schemaVersion: '1.0', dimension: 'd', riskLevel: 'high', issue: 'i', recommendation: 'r', citations: [], confidenceScore: 80, stance: 'agree' }).valid).toBe(true);
    expect(validateOpinion({ schemaVersion: '1.0', dimension: 'd', riskLevel: 'high', issue: 'i', recommendation: 'r', citations: [], confidenceScore: 80, stance: 'maybe' as any }).valid).toBe(false);
  });
});
