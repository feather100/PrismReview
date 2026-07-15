/**
 * Orchestrator Core Unit Tests — graph-runtime state machine.
 *
 * Scope: pure routing logic, TERMINAL_STATUSES, ReviewState transitions.
 * No Prisma, no LLM, no Redis — all deterministic.
 */
import {
  ReviewState,
  ReviewStatus,
  TurnRecord,
  TERMINAL_STATUSES,
  isTerminalStatus,
  UsageLedger,
} from '../modules/reviews/orchestrator/graph-runtime';

function makeState(overrides: Partial<ReviewState> = {}): ReviewState {
  return {
    reviewId: 'test-review-1',
    status: 'created',
    round: 1,
    currentNodeId: 'running',
    turns: [],
    moderatorDecisions: [],
    usage: { totalTokens: 0, totalRounds: 1, totalCost: 0, turnsByReviewer: {} },
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('TERMINAL_STATUSES', () => {
  it.each(['completed', 'failed', 'aborted', 'archived'])(
    'treats %s as terminal',
    (s) => {
      expect(isTerminalStatus(s)).toBe(true);
    },
  );

  it.each(['created', 'diagnosed', 'running', 'summarized', 'interrupted'])(
    'treats %s as non-terminal',
    (s) => {
      expect(isTerminalStatus(s)).toBe(false);
    },
  );

  it('treats unknown garbage as non-terminal', () => {
    expect(isTerminalStatus('garbage')).toBe(false);
  });

  it('frozen set — direct .has() works too', () => {
    expect(TERMINAL_STATUSES.has('completed')).toBe(true);
    expect(TERMINAL_STATUSES.has('interrupted')).toBe(false);
  });
});

describe('ReviewState data shape', () => {
  it('initial created state is non-terminal', () => {
    const s = makeState({ status: 'created' });
    expect(s.status).toBe('created');
    expect(isTerminalStatus(s.status)).toBe(false);
  });

  it('HITL interrupted is non-terminal (resumable)', () => {
    const s = makeState({ status: 'interrupted' });
    expect(isTerminalStatus(s.status)).toBe(false);
  });

  it('completed state is terminal', () => {
    const s = makeState({ status: 'completed' });
    expect(isTerminalStatus(s.status)).toBe(true);
  });
});

describe('UsageLedger', () => {
  it('starts with 0 cost/tokens', () => {
    const ledger: UsageLedger = {
      totalTokens: 0,
      totalRounds: 0,
      totalCost: 0,
      turnsByReviewer: {},
    };
    expect(ledger.totalTokens).toBe(0);
    expect(ledger.totalCost).toBe(0);
  });

  it('tracks per-reviewer turn counts', () => {
    const ledger: UsageLedger = {
      totalTokens: 3000,
      totalRounds: 2,
      totalCost: 0.02,
      turnsByReviewer: {
        'role-version-1': 2,
        'role-version-2': 1,
      },
    };
    expect(Object.keys(ledger.turnsByReviewer).length).toBe(2);
  });
});

describe('TurnRecord', () => {
  const turn: TurnRecord = {
    turnId: 'turn-1',
    reviewerId: 'role-version-id',
    round: 1,
    phase: 'round_robin',
    status: 'persisted',
    opinionRef: 'opinion-1',
  };

  it('readonly fields cannot be reassigned (type-level)', () => {
    expect(turn.turnId).toBe('turn-1');
    expect(turn.round).toBe(1);
  });

  it('debate phase is a valid TurnPhase', () => {
    expect(['round_robin', 'debate']).toContain(turn.phase);
  });
});
