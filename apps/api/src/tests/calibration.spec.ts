/**
 * T10 (Sprint 11.0) — Score calibration (AI vs human).
 *
 * Scope:
 *  - computeSimilarity（CJK 二元组 Jaccard）
 *  - computeCalibration（|Δ| 标记 / 相似度标记 / MAE / 空输入）
 */
import {
  computeCalibration,
  computeSimilarity,
  HumanScore,
  AiDimensionScore,
} from '../modules/reviews/quality/calibration';

describe('computeSimilarity', () => {
  it('high similarity for same keywords', () => {
    expect(computeSimilarity('存在单点故障风险', '存在单点故障风险')).toBeGreaterThan(0.8);
  });

  it('low similarity for unrelated text', () => {
    const s = computeSimilarity('存在单点故障风险', '完全无关的词汇组合');
    expect(s).toBeLessThan(0.4);
  });

  it('zero for empty text', () => {
    expect(computeSimilarity('', '单点故障')).toBe(0);
    expect(computeSimilarity('单点故障', '')).toBe(0);
  });
});

describe('computeCalibration', () => {
  const humans: HumanScore[] = [
    { dimension: '架构合理性', score: 60, comment: '存在单点故障风险，需多副本部署' },
    { dimension: '投入产出分析', score: 40 },
    { dimension: '用户体验', score: 75 },
  ];
  const ais: AiDimensionScore[] = [
    { dimension: '架构合理性', aiScore: 43, aiIssue: '存在单点故障风险' },
    { dimension: '投入产出分析', aiScore: 78 },
    { dimension: '用户体验', aiScore: 80 },
  ];

  it('flags |Δ|>15 rows and computes MAE', () => {
    const r = computeCalibration(humans, ais);
    expect(r.total).toBe(3);
    // 架构合理性 |43-60|=17 > 15 → flagged（相似度不参与，因为 >0.4）
    const arch = r.rows.find((x) => x.dimension === '架构合理性')!;
    expect(arch.flagged).toBe(true);
    expect(arch.flagReason.join('|')).toContain('|Δ|=17');
    // 投入产出 |78-40|=38 > 15 → flagged
    const roi = r.rows.find((x) => x.dimension === '投入产出分析')!;
    expect(roi.flagged).toBe(true);
    // 用户体验 |80-75|=5 → not flagged
    const ux = r.rows.find((x) => x.dimension === '用户体验')!;
    expect(ux.flagged).toBe(false);
    // MAE = (17+38+5)/3 = 20
    expect(r.mae).toBeCloseTo(20, 0);
    expect(r.flaggedCount).toBe(2);
  });

  it('flags by low similarity when texts provided', () => {
    const r = computeCalibration(
      [{ dimension: 'D', score: 50, comment: '完全无关的词汇组合' }],
      [{ dimension: 'D', aiScore: 50, aiIssue: '存在单点故障风险' }],
    );
    const row = r.rows[0];
    expect(row.delta).toBe(0); // 分数一致
    expect(row.similarity).toBeLessThan(0.4);
    expect(row.flagged).toBe(true);
    expect(row.flagReason.join('|')).toContain('similarity');
  });

  it('similarity is null when texts missing (delta-only)', () => {
    const r = computeCalibration(
      [{ dimension: 'D', score: 50 }],
      [{ dimension: 'D', aiScore: 60 }],
    );
    expect(r.rows[0].similarity).toBeNull();
    expect(r.rows[0].flagged).toBe(false); // |Δ|=10 ≤ 15 且无相似度依据 → 不标记
  });

  it('handles empty humanScores', () => {
    const r = computeCalibration([], []);
    expect(r).toEqual({ rows: [], mae: 0, flaggedCount: 0, total: 0 });
  });

  it('respects custom deltaThreshold', () => {
    const r = computeCalibration(
      [{ dimension: 'D', score: 50 }],
      [{ dimension: 'D', aiScore: 60 }],
      { deltaThreshold: 5 },
    );
    expect(r.rows[0].flagged).toBe(true); // 10 > 5
  });
});
