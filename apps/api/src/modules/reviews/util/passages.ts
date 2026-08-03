/**
 * passages.ts — T9 (Sprint 11.0) 段落级锚点（来源：PaperJury 模式 J passage_id）
 *
 * 评审意见可锚定到原文段落（passageId + excerpt），报告支持跳转原文。
 * - extractPassages：按空行切段，生成稳定 passageId（p1, p2, …）；
 * - linkPassages：意见 issue 与段落做关键词重叠匹配，返回 topK 锚点（确定性，可单测）。
 */
export interface Passage {
  readonly passageId: string;
  readonly text: string;
}

export interface PassageRef {
  readonly passageId: string;
  readonly excerpt: string;
}

/** 提取 CJK 二元组 + 拉丁词（≥3 字符）作为匹配关键词。 */
export function extractKeywords(text: string): Set<string> {
  const set = new Set<string>();
  const s = (text || '').trim();
  if (!s) return set;
  // CJK 连续串 → 二元组
  const cjkRun = s.match(/[一-鿿]+/g) ?? [];
  for (const run of cjkRun) {
    if (run.length === 1) { set.add(run); continue; }
    for (let i = 0; i < run.length - 1; i++) set.add(run.slice(i, i + 2));
  }
  // 拉丁词
  const words = s.match(/[a-zA-Z]{3,}/g) ?? [];
  for (const w of words) set.add(w.toLowerCase());
  return set;
}

/** 按空行切分为段落，生成稳定 passageId。 */
export function extractPassages(content: string): Passage[] {
  const text = (content || '').trim();
  if (!text) return [];
  const paragraphs = text.split(/\n\s*\n/);
  const passages: Passage[] = [];
  for (const p of paragraphs) {
    const clean = p.replace(/\r/g, '').trim();
    if (!clean) continue;
    passages.push({ passageId: `p${passages.length + 1}`, text: clean });
  }
  return passages;
}

/** 意见 issue → 段落锚点（关键词重叠 topK）。无匹配返回空数组。 */
export function linkPassages(issue: string, passages: Passage[], topK = 2): PassageRef[] {
  const tokens = extractKeywords(issue);
  if (tokens.size === 0 || passages.length === 0) return [];
  const scored = passages
    .map((p) => {
      let score = 0;
      for (const t of tokens) if (p.text.includes(t)) score++;
      return { passageId: p.passageId, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const map = new Map(passages.map((p) => [p.passageId, p]));
  return scored.slice(0, topK).map((x) => ({
    passageId: x.passageId,
    excerpt: (map.get(x.passageId)?.text ?? '').substring(0, 200),
  }));
}
