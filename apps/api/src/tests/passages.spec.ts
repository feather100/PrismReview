/**
 * T9 (Sprint 11.0) — Passage-level anchors.
 *
 * Scope:
 *  - extractPassages（空行切段 + 稳定 passageId）
 *  - extractKeywords（CJK 二元组 + 拉丁词）
 *  - linkPassages（意见 issue → 段落锚点，关键词重叠 topK）
 */
import {
  extractPassages,
  extractKeywords,
  linkPassages,
  Passage,
} from '../modules/reviews/util/passages';

const DOC = [
  '第一部分：项目背景。',
  '本方案采用微服务架构，包含订单与支付模块。',
  '',
  '第二部分：技术选型。',
  '选用 Kubernetes 部署，Redis 缓存热点数据。',
  '',
  '第三部分：风险。',
  '存在单点故障风险，需要多副本部署与熔断机制。',
].join('\n');

describe('extractPassages', () => {
  it('splits by blank lines with stable passageIds', () => {
    const ps = extractPassages(DOC);
    expect(ps.length).toBe(3);
    expect(ps[0].passageId).toBe('p1');
    expect(ps[2].passageId).toBe('p3');
    expect(ps[2].text).toContain('单点故障');
  });

  it('returns empty for blank content', () => {
    expect(extractPassages('')).toEqual([]);
    expect(extractPassages('   ')).toEqual([]);
  });
});

describe('extractKeywords', () => {
  it('extracts CJK bigrams and latin words', () => {
    const k = extractKeywords('存在单点故障风险 circuit');
    expect(k.has('存在')).toBe(true);
    expect(k.has('单点')).toBe(true);
    expect(k.has('故障')).toBe(true);
    expect(k.has('circuit')).toBe(true);
  });
});

describe('linkPassages', () => {
  const passages: Passage[] = extractPassages(DOC);

  it('links the issue to the passage with most keyword overlap', () => {
    const refs = linkPassages('存在单点故障风险', passages, 2);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs[0].passageId).toBe('p3');
    expect(refs[0].excerpt).toContain('单点故障');
  });

  it('returns empty when no overlap', () => {
    const refs = linkPassages('完全无关的内容词汇', [passages[0]], 2);
    expect(refs).toEqual([]);
  });

  it('respects topK limit', () => {
    const refs = linkPassages('存在单点故障风险 部署 方案', passages, 1);
    expect(refs.length).toBeLessThanOrEqual(1);
  });

  it('returns empty for empty issue or passages', () => {
    expect(linkPassages('', passages)).toEqual([]);
    expect(linkPassages('单点故障', [])).toEqual([]);
  });
});
