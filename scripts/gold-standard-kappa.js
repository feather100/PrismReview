#!/usr/bin/env node
/**
 * gold-standard-kappa.js — Fleiss' Kappa 计算脚本（评分可信度验证 Gold Standard）。
 *
 * 用法：
 *   node scripts/gold-standard-kappa.js <scores.csv>
 *
 * CSV 列（与 docs/research/gold-standard/scores-template.csv 对齐）：
 *   document_id, expert_id, dimension, score, overall_score, key_issue, confidence
 *
 * 输出：整体 Fleiss κ + 每维度 κ（subject=文档×维度，评定者=专家，评分按 5 分桶）。
 * 门槛：κ ≥ 0.6 视为专家间一致性可接受（进入 AI 对照阶段）。
 *
 * 无第三方依赖（Node ≥ 14）。
 */
const fs = require('fs');
const path = require('path');

const BUCKET = 5; // 评分分桶粒度（0–100 → 21 个桶）

function fleissKappa(ratings) {
  // ratings: Array<Array<number>> —— 每个 subject（文档×维度）的每位评定者评分（已分桶）
  const subjects = ratings.length;
  if (subjects === 0) return { kappa: NaN, n: 0 };
  const n = ratings[0].length; // 评定者数
  if (n <= 1) return { kappa: NaN, n: 0 };

  const categories = new Set();
  for (const r of ratings) for (const v of r) categories.add(v);

  // P_i：每个 subject 的一致度
  let sumP = 0;
  for (const r of ratings) {
    const counts = new Map();
    for (const v of r) counts.set(v, (counts.get(v) || 0) + 1);
    let s = 0;
    for (const c of counts.values()) s += c * c;
    sumP += (s - n) / (n * (n - 1));
  }
  const Pbar = sumP / subjects;

  // P_e：期望一致度
  let Pe = 0;
  for (const cat of categories) {
    let count = 0;
    for (const r of ratings) count += r.filter((v) => v === cat).length;
    const p = count / (subjects * n);
    Pe += p * p;
  }

  const kappa = Pe === 1 ? 1 : (Pbar - Pe) / (1 - Pe);
  return { kappa, n: subjects };
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = lines[0].split(',').map((s) => s.trim().toLowerCase());
  const rows = lines.slice(1).map((l) => {
    const cells = l.split(',').map((s) => s.trim());
    const obj = {};
    header.forEach((h, i) => (obj[h] = cells[i]));
    return obj;
  });
  return rows;
}

function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('用法: node scripts/gold-standard-kappa.js <scores.csv>');
    process.exit(1);
  }
  const text = fs.readFileSync(path.resolve(csvPath), 'utf8');
  const rows = parseCsv(text);

  // subject = document_id × dimension；评定者 = expert_id
  const bySubject = new Map();
  const experts = new Set();
  for (const r of rows) {
    const key = `${r.document_id}|${r.dimension}`;
    if (!bySubject.has(key)) bySubject.set(key, new Map());
    const bucket = Math.round(Number(r.score) / BUCKET);
    bySubject.get(key).set(r.expert_id, bucket);
    experts.add(r.expert_id);
  }

  const ratings = [...bySubject.values()].map((m) => [...m.values()]);
  const overall = fleissKappa(ratings);

  // 每维度 κ
  const byDim = new Map();
  for (const r of rows) {
    if (!byDim.has(r.dimension)) byDim.set(r.dimension, new Map());
    const dimMap = byDim.get(r.dimension);
    if (!dimMap.has(r.document_id)) dimMap.set(r.document_id, new Map());
    dimMap.get(r.document_id).set(r.expert_id, Math.round(Number(r.score) / BUCKET));
  }
  const dimKappa = {};
  for (const [dim, subj] of byDim) {
    dimKappa[dim] = fleissKappa([...subj.values()].map((m) => [...m.values()]));
  }

  console.log('=== Gold Standard 一致性（Fleiss Kappa）===');
  console.log('文档×维度 subjects:', overall.n, '| 专家数:', experts.size);
  console.log('整体 κ:', Number(overall.kappa.toFixed(4)), overall.kappa >= 0.6 ? '✅ ≥0.6 通过' : '❌ <0.6 需对齐 rubric 后重评');
  console.log('--- 每维度 ---');
  for (const [dim, k] of Object.entries(dimKappa)) {
    console.log(`  ${dim}: κ=${Number(k.kappa.toFixed(4))} (n=${k.n})`);
  }
}

main();
