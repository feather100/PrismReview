/**
 * T5+T6 (Sprint 11.0) — 按动作降级 + 成本硬闸.
 *
 * Scope:
 *  - classifyTurnError / DEGRADATION_MATRIX / buildTurnObservability（T5）
 *  - estimateCostUsd / extractTokens / extractProviderName（T6 成本模型）
 *  - workflow maxCostUsd presets + validateCustom（T6）
 *  - computeRuleCheck 成本语义 + MockModerator 成本超限 → 强制收敛（T6）
 */
import {
  classifyTurnError,
  buildTurnObservability,
  DEGRADATION_MATRIX,
} from '../modules/reviews/provider/degradation';
import {
  estimateCostUsd,
  extractTokens,
  extractProviderName,
} from '../modules/reviews/provider/cost-model';
import {
  computeRuleCheck,
  MockModerator,
  HardGates,
  DEFAULT_HARD_GATES,
} from '../modules/reviews/orchestrator/moderator';
import { WorkflowRegistry, PRESET_WORKFLOWS, WorkflowId } from '../modules/workflow/workflow.registry';
import { ReviewState } from '../modules/reviews/orchestrator/graph-runtime';

// ── T5：按动作降级 ───────────────────────────────────────────

describe('classifyTurnError (T5)', () => {
  it('auth errors (401/403) → fail closed, no fallback', () => {
    expect(classifyTurnError(new Error('HTTP 401 Unauthorized'), 'openai_compatible')).toBe('auth_fail_closed');
    expect(classifyTurnError(new Error('HTTP 403 Forbidden'), 'lmstudio')).toBe('auth_fail_closed');
  });

  it('guard errors → fail closed', () => {
    expect(classifyTurnError(new Error('MODEL PROVIDER GUARD: missing key'), 'openai_compatible')).toBe('guard_fail_closed');
  });

  it('runtime error on real provider → single-turn fallback to mock', () => {
    expect(classifyTurnError(new Error('ECONNREFUSED 127.0.0.1:1234'), 'openai_compatible')).toBe('fallback_mock');
  });

  it('mock itself failing → fail closed (should not happen)', () => {
    expect(classifyTurnError(new Error('mock boom'), 'mock')).toBe('mock_fail_closed');
  });
});

describe('DEGRADATION_MATRIX / buildTurnObservability (T5)', () => {
  it('fallback_mock is the only labelled fallback', () => {
    expect(DEGRADATION_MATRIX.fallback_mock.fallback).toBe(true);
    expect(DEGRADATION_MATRIX.fallback_mock.providerSource).toBe('fallback_mock');
    expect(DEGRADATION_MATRIX.auth_fail_closed.providerSource).toBe('failed');
  });

  it('builds observability with token details', () => {
    const obs = buildTurnObservability({
      providerSource: 'openai_compatible',
      providerName: 'openai_compatible',
      modelName: 'm',
      fallback: false,
      durationMs: 10,
      tokens: { prompt: 100, completion: 50, total: 150 },
    });
    expect(obs.tokens).toEqual({ prompt: 100, completion: 50, total: 150 });
    expect(obs.providerSource).toBe('openai_compatible');
  });
});

// ── T6：成本模型 ─────────────────────────────────────────────

describe('estimateCostUsd (T6)', () => {
  it('local/mock providers cost zero', () => {
    expect(estimateCostUsd('mock', { prompt: 1000, completion: 500 })).toBe(0);
    expect(estimateCostUsd('lmstudio', { prompt: 1000, completion: 500 })).toBe(0);
    expect(estimateCostUsd('fallback_mock', { prompt: 100, completion: 50 })).toBe(0);
  });

  it('openai_compatible: 1000 in + 500 out = $0.0035', () => {
    const cost = estimateCostUsd('openai_compatible', { prompt: 1000, completion: 500 });
    expect(cost).toBeCloseTo(0.0035, 6); // 1000*0.0015/1000 + 500*0.004/1000
  });

  it('falls back to total × input price when split unknown', () => {
    const cost = estimateCostUsd('openai_compatible', { total: 2000 });
    expect(cost).toBeCloseTo(0.003, 6); // 2000 * 0.0015 / 1000
  });

  it('null usage → zero', () => {
    expect(estimateCostUsd('openai_compatible', null)).toBe(0);
  });
});

describe('extractTokens / extractProviderName (T6)', () => {
  it('parses tokens from observability object', () => {
    expect(extractTokens({ tokens: { prompt: 1, completion: 2, total: 3 } })).toEqual({ prompt: 1, completion: 2, total: 3 });
    expect(extractTokens({ tokens: null })).toBeNull();
    expect(extractTokens(null)).toBeNull();
  });

  it('resolves providerName with providerSource fallback', () => {
    expect(extractProviderName({ providerName: 'openai_compatible', providerSource: 'x' })).toBe('openai_compatible');
    expect(extractProviderName({ providerSource: 'fallback_mock' })).toBe('fallback_mock');
    expect(extractProviderName(null)).toBe('mock');
  });
});

// ── T6：workflow 成本上限 ────────────────────────────────────

describe('workflow maxCostUsd (T6)', () => {
  it('all 4 presets carry a cost cap', () => {
    for (const id of Object.keys(PRESET_WORKFLOWS) as WorkflowId[]) {
      expect(typeof PRESET_WORKFLOWS[id].maxCostUsd).toBe('number');
      expect(PRESET_WORKFLOWS[id].maxCostUsd!).toBeGreaterThan(0);
    }
  });

  it('enterprise cap = 1.0 USD', () => {
    expect(PRESET_WORKFLOWS.enterprise.maxCostUsd).toBe(1.0);
  });

  it('validateCustom rejects negative/non-numeric cap', () => {
    const registry = new WorkflowRegistry();
    const bad = registry.validateCustom({
      scoringWeights: { byDimension: { A: 1 }, fallback: 'uniform' },
      maxCostUsd: -1,
    } as any);
    expect(bad.ok).toBe(false);
    expect(bad.errors.join('|')).toContain('maxCostUsd');
  });
});

// ── T6：computeRuleCheck 成本语义 + MockModerator ─────────────

const GATES: HardGates = { maxRounds: 3, maxTurnsPerReviewer: 3, minRounds: 1, maxTokensPerReview: 200_000, maxCostPerReview: 1.0 };

function state(round: number, totalCost = 0): ReviewState {
  return {
    reviewId: 'test-review',
    status: 'running',
    round,
    currentNodeId: 'running',
    turns: [],
    moderatorDecisions: [],
    usage: { totalRounds: round, totalTokens: 1000, totalCost, turnsByReviewer: { rv1: 1, rv2: 1 } },
    updatedAt: new Date().toISOString(),
  };
}

describe('computeRuleCheck — cost (T6)', () => {
  it('fails maxCostOk when totalCost exceeds cap', () => {
    const r = computeRuleCheck(state(2, 5), GATES);
    expect(r.maxCostOk).toBe(false);
    expect(r.passed).toBe(false);
  });

  it('passes cost when within cap', () => {
    const r = computeRuleCheck(state(2, 0.5), GATES);
    expect(r.maxCostOk).toBe(true);
  });

  it('Infinity cap never breaches', () => {
    const r = computeRuleCheck(state(2, 1e9), { ...GATES, maxCostPerReview: Number.POSITIVE_INFINITY });
    expect(r.maxCostOk).toBe(true);
  });
});

describe('MockModerator.decide — cost cap forced converge (T6)', () => {
  function decidePrisma(audit?: any) {
    return {
      reviewTurn: { findMany: jest.fn().mockResolvedValue([]) },
      reviewOpinion: { findMany: jest.fn().mockResolvedValue([]) },
      moderatorDecision: { create: jest.fn().mockResolvedValue({ id: 'dec-1', createdAt: new Date() }) },
      ...(audit ? { auditLog: { create: jest.fn().mockResolvedValue({}) } } : {}),
    } as any;
  }

  it('converges (not force_stop) when cost cap reached', async () => {
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const m = new MockModerator(decidePrisma(), audit as any);
    const d = await m.decide(state(2, 5), GATES); // totalCost 5 > cap 1.0
    expect(d.decisionType).toBe('converge');
    expect(d.reasoning).toContain('cost cap reached');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'review.cost_cap_reached' }));
  });

  it('still force_stops when maxRounds breached even with cost breach', async () => {
    const m = new MockModerator(decidePrisma());
    const d = await m.decide(state(4, 5), GATES); // round 4 > maxRounds 3
    expect(d.decisionType).toBe('force_stop');
  });

  it('cost cap 0 disables cost branch (legacy gates)', async () => {
    const m = new MockModerator(decidePrisma());
    const d = await m.decide(state(1, 0), { ...DEFAULT_HARD_GATES }); // maxCostPerReview=0 → disabled
    expect(d.decisionType).toBe('converge'); // 常规 round-1 收敛（cost 不参与）
  });
});
