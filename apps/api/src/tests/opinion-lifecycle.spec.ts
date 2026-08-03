/**
 * T1 (Sprint 11.0) — Opinion Lifecycle + content-key dedup.
 *
 * Scope:
 *  - isReportable / VALID_TRANSITIONS / assertTransition（纯规则）
 *  - normalizeIssueKey / computeDedupKey（内容键去重）
 *  - computeFinalization / collectMerges（终结化决策，纯函数）
 *  - OpinionLifecycleService.finalizeReview / transition（内存 prisma mock + 审计 mock）
 */
import {
  OpinionLifecycleService,
  assertTransition,
  isReportable,
  computeFinalization,
  collectMerges,
  REPORTABLE_STATUSES,
} from '../modules/reviews/orchestrator/opinion-lifecycle';
import { computeDedupKey, normalizeIssueKey } from '../modules/reviews/orchestrator/opinion';

// ── 纯规则 ─────────────────────────────────────────────────────

describe('isReportable', () => {
  it('excludes rejected only', () => {
    expect(isReportable('accepted')).toBe(true);
    expect(isReportable('downgraded')).toBe(true);
    expect(isReportable('candidate')).toBe(true); // 兜底：finalize 失败也不空白报告
    expect(isReportable('rejected')).toBe(false);
  });

  it('treats null/undefined (legacy rows) as reportable', () => {
    expect(isReportable(null)).toBe(true);
    expect(isReportable(undefined)).toBe(true);
  });

  it('REPORTABLE_STATUSES contains exactly candidate/accepted/downgraded', () => {
    expect([...REPORTABLE_STATUSES].sort()).toEqual(['accepted', 'candidate', 'downgraded']);
  });
});

describe('assertTransition', () => {
  it('allows candidate → challenged/accepted/rejected/downgraded', () => {
    expect(() => assertTransition('candidate', 'challenged')).not.toThrow();
    expect(() => assertTransition('candidate', 'accepted')).not.toThrow();
    expect(() => assertTransition('candidate', 'rejected')).not.toThrow();
    expect(() => assertTransition('candidate', 'downgraded')).not.toThrow();
  });

  it('allows challenged → candidate (revise) / accepted / rejected / downgraded', () => {
    expect(() => assertTransition('challenged', 'candidate')).not.toThrow();
    expect(() => assertTransition('challenged', 'accepted')).not.toThrow();
  });

  it('allows accepted → downgraded only', () => {
    expect(() => assertTransition('accepted', 'downgraded')).not.toThrow();
    expect(() => assertTransition('accepted', 'rejected')).toThrow(/Illegal opinion transition/);
    expect(() => assertTransition('accepted', 'challenged')).toThrow(/Illegal opinion transition/);
  });

  it('rejects terminal-state transitions', () => {
    expect(() => assertTransition('rejected', 'accepted')).toThrow(/Illegal opinion transition/);
    expect(() => assertTransition('downgraded', 'accepted')).toThrow(/Illegal opinion transition/);
  });

  it('treats null/undefined from as candidate', () => {
    expect(() => assertTransition(null, 'accepted')).not.toThrow();
    expect(() => assertTransition(undefined, 'challenged')).not.toThrow();
  });
});

describe('normalizeIssueKey / computeDedupKey', () => {
  it('folds case, whitespace and CJK punctuation', () => {
    expect(normalizeIssueKey(' 存在单点故障风险 ')).toBe(normalizeIssueKey('存在单点故障风险'));
    expect(normalizeIssueKey('A，B. C')).toBe(normalizeIssueKey('a b c'));
  });

  it('builds dimension:issue key', () => {
    expect(computeDedupKey('架构合理性', '存在单点故障风险')).toBe(
      '架构合理性:存在单点故障风险',
    );
    // 保守归一化：折叠标点/空白为单空格，不删除空格（避免误合并不同问题）
    expect(computeDedupKey('架构合理性', '存在单点故障风险。')).toBe(
      computeDedupKey('架构合理性', '存在单点故障风险'),
    );
  });
});

// ── 终结化决策（纯函数）────────────────────────────────────────

describe('computeFinalization', () => {
  it('accepts candidates and keeps already-resolved opinions', () => {
    const opinions = [
      { id: 'o1', dimension: '架构', issue: '单点故障', status: 'candidate' },
      { id: 'o2', dimension: '架构', issue: '性能瓶颈', status: 'candidate' },
      { id: 'o3', dimension: '安全', issue: '密钥泄漏', status: 'accepted' },
    ];
    const decisions = computeFinalization(opinions);
    expect(decisions.filter((d) => d.kind === 'accept').map((d) => (d as any).opinionId)).toEqual(['o1', 'o2']);
    expect(decisions.filter((d) => d.kind === 'keep').map((d) => (d as any).opinionId)).toEqual(['o3']);
    expect(decisions.filter((d) => d.kind === 'rejectDuplicate')).toHaveLength(0);
  });

  it('rejects later duplicates of the same content key and keeps the first as canonical', () => {
    const opinions = [
      { id: 'o1', dimension: '架构', issue: '存在单点故障风险', status: 'candidate', reviewerId: 'rv-cto' },
      { id: 'o2', dimension: '架构', issue: '存在单点故障风险。', status: 'candidate', reviewerId: 'rv-cfo' },
      { id: 'o3', dimension: '安全', issue: '密钥明文存储', status: 'candidate', reviewerId: 'rv-sec' },
    ];
    const decisions = computeFinalization(opinions);
    const dup = decisions.find((d) => d.kind === 'rejectDuplicate') as
      | { kind: 'rejectDuplicate'; opinionId: string; canonicalId: string }
      | undefined;
    expect(dup).toBeDefined();
    expect(dup!.opinionId).toBe('o2');
    expect(dup!.canonicalId).toBe('o1');
    expect(decisions.filter((d) => d.kind === 'accept').map((d) => (d as any).opinionId)).toEqual(['o1', 'o3']);
  });

  it('does not let a rejected opinion occupy the canonical key', () => {
    const opinions = [
      { id: 'o1', dimension: '架构', issue: '单点故障', status: 'rejected', reviewerId: 'rv-a' },
      { id: 'o2', dimension: '架构', issue: '单点故障', status: 'candidate', reviewerId: 'rv-b' },
    ];
    const decisions = computeFinalization(opinions);
    // o2 不应被当作 o1 的重复（o1 已 rejected，不占位）
    expect(decisions.filter((d) => d.kind === 'rejectDuplicate')).toHaveLength(0);
    expect(decisions.filter((d) => d.kind === 'accept').map((d) => (d as any).opinionId)).toEqual(['o2']);
  });

  it('collectMerges maps duplicate reviewer ids to canonical', () => {
    const opinions = [
      { id: 'o1', dimension: '架构', issue: '单点故障', status: 'candidate', reviewerId: 'rv-cto' },
      { id: 'o2', dimension: '架构', issue: '单点故障', status: 'candidate', reviewerId: 'rv-cfo' },
    ];
    const decisions = computeFinalization(opinions);
    const merges = collectMerges(opinions, decisions);
    expect(merges).toEqual([{ canonicalId: 'o1', mergedReviewerId: 'rv-cfo' }]);
  });
});

// ── 服务层（内存 prisma mock）──────────────────────────────────

interface MemOpinion {
  id: string;
  reviewId: string;
  dimension: string;
  issue: string;
  status: string | null;
  createdAt: Date;
  mergedReviewerIds?: string[] | null;
  canonicalOpinionId?: string | null;
  resolutionReason?: string | null;
  reviewerId?: string | null;
}

function makeService(seed: MemOpinion[]) {
  const rows: MemOpinion[] = seed.map((o) => ({ ...o }));
  const auditCalls: Array<{ action: string; resourceId?: string | null }> = [];

  const prisma = {
    reviewOpinion: {
      findMany: async ({ where }: any) =>
        rows.filter((r) => !where || r.reviewId === where.reviewId),
      findFirst: async ({ where }: any) =>
        rows.find((r) => r.id === where.id && r.reviewId === where.reviewId) ?? null,
      update: async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      },
    },
    $transaction: async (fn: (tx: any) => Promise<void>) => fn(prisma),
  };

  const audit = {
    log: async (input: { action: string; resourceId?: string | null }) => {
      auditCalls.push(input);
    },
  };

  const service = new OpinionLifecycleService(prisma as any, audit as any);
  return { service, rows, auditCalls };
}

describe('OpinionLifecycleService.finalizeReview', () => {
  it('accepts candidates and rejects duplicates in one pass', async () => {
    const { service, rows, auditCalls } = makeService([
      { id: 'o1', reviewId: 'r1', dimension: '架构', issue: '单点故障', status: 'candidate', createdAt: new Date('2026-08-03T00:00:00Z'), reviewerId: 'rv-cto' },
      { id: 'o2', reviewId: 'r1', dimension: '架构', issue: '单点故障', status: 'candidate', createdAt: new Date('2026-08-03T00:01:00Z'), reviewerId: 'rv-cfo' },
      { id: 'o3', reviewId: 'r1', dimension: '安全', issue: '密钥泄漏', status: 'candidate', createdAt: new Date('2026-08-03T00:02:00Z'), reviewerId: 'rv-sec' },
    ]);

    const result = await service.finalizeReview('r1', { tenantId: 't1', userId: 'u1' });
    expect(result).toEqual({ accepted: 2, rejectedDuplicates: 1, merged: 1 });

    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get('o1')!.status).toBe('accepted');
    expect(byId.get('o3')!.status).toBe('accepted');
    expect(byId.get('o2')!.status).toBe('rejected');
    expect(byId.get('o2')!.canonicalOpinionId).toBe('o1');
    expect(byId.get('o2')!.resolutionReason).toBe('duplicate_of:o1');
    expect(byId.get('o1')!.mergedReviewerIds).toContain('rv-cfo');

    const actions = auditCalls.map((c) => c.action);
    expect(actions).toContain('review.opinion.accepted');
    expect(actions).toContain('review.opinion.rejected.duplicate');
  });

  it('is a no-op when review has no opinions', async () => {
    const { service } = makeService([]);
    const result = await service.finalizeReview('r-empty');
    expect(result).toEqual({ accepted: 0, rejectedDuplicates: 0, merged: 0 });
  });

  it('skips already-resolved opinions (keep)', async () => {
    const { service, rows } = makeService([
      { id: 'o1', reviewId: 'r1', dimension: '架构', issue: '单点故障', status: 'accepted', createdAt: new Date('2026-08-03T00:00:00Z') },
      { id: 'o2', reviewId: 'r1', dimension: '安全', issue: '密钥泄漏', status: 'rejected', createdAt: new Date('2026-08-03T00:01:00Z') },
    ]);
    await service.finalizeReview('r1');
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get('o1')!.status).toBe('accepted'); // 不变
    expect(byId.get('o2')!.status).toBe('rejected'); // 不变
  });
});

describe('OpinionLifecycleService.transition', () => {
  it('applies a valid transition and audits it', async () => {
    const { service, rows, auditCalls } = makeService([
      { id: 'o1', reviewId: 'r1', dimension: '架构', issue: '单点故障', status: 'challenged', createdAt: new Date() },
    ]);
    const res = await service.transition('r1', 'o1', 'accepted', 'moderator:证据链充分');
    expect(res).toEqual({ ok: true, from: 'challenged', to: 'accepted' });
    expect(rows[0].status).toBe('accepted');
    expect(rows[0].resolutionReason).toBe('moderator:证据链充分');
    expect(auditCalls.some((c) => c.action === 'review.opinion.accepted')).toBe(true);
  });

  it('throws on illegal transition', async () => {
    const { service } = makeService([
      { id: 'o1', reviewId: 'r1', dimension: '架构', issue: '单点故障', status: 'rejected', createdAt: new Date() },
    ]);
    await expect(service.transition('r1', 'o1', 'accepted', 'nope')).rejects.toThrow(
      /Illegal opinion transition/,
    );
  });

  it('throws when opinion not found in review', async () => {
    const { service } = makeService([]);
    await expect(service.transition('r1', 'missing', 'accepted', 'x')).rejects.toThrow(
      /Opinion not found/,
    );
  });
});
