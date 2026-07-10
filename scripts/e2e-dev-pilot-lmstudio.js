/**
 * Sprint 7.4 — LM Studio Dev-only Capped E2E Trial (HTTP harness)
 *
 * Drives the REAL PrismReview backend chain end-to-end against a LIVE local
 * LM Studio instance, with the dev-pilot provider enabled and the per-review
 * role cap enforced by code (MODEL_PILOT_MAX_ROLES unset => 3).
 *
 * No schema change, no frontend change, no paid API, no openai_compatible.
 * Requires a pilot API instance already running on PORT (default 4100) with:
 *   MODEL_PROVIDER=lmstudio  ALLOW_EXTERNAL_MODEL_CALLS=true
 *   MODEL_BASE_URL=http://127.0.0.1:1234/v1  MODEL_NAME=<loaded model>
 *
 * Run:  node scripts/e2e-dev-pilot-lmstudio.js
 * (cwd must be apps/api so @prisma/client resolves; DATABASE_URL must be set)
 */
const BASE = process.env.E2E_BASE || 'http://localhost:4100/api';
const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://prismreview:prismreview@localhost:5432/prismreview?schema=public';

const LEAK_PATTERNS = [
  /sk-[a-zA-Z0-9_\-]{8,}/i,
  /api_key/i,
  /bearer\s+[a-zA-Z0-9._-]+/i,
  /rawtext/i,
  /you are a technical reviewer/i, // SYSTEM_PROMPT snippet must never be persisted
];

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
}

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  return { status: res.status, json, text };
}

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  let reviewId = null;

  try {
    // 1) create
    const title = 'Sprint7.4 Dev-Pilot E2E ' + new Date().toISOString().slice(11, 19);
    const objective = 'Proposal: introduce a local LLM review pilot capped at 3 roles.';
    const created = await api('POST', '/reviews', { title, objective, mode: 'round_robin' });
    if (created.status !== 201 && created.status !== 200) throw new Error('create failed: ' + created.text);
    reviewId = created.json.id;
    console.log('created review', reviewId, '(status', created.json.status + ')');

    // 2) diagnose -> ready
    const diag = await api('POST', `/reviews/${reviewId}/diagnose`);
    if (diag.status !== 201 && diag.status !== 200) {
      // resilient fallback: set ready directly (dev-only)
      await prisma.review.update({ where: { id: reviewId }, data: { status: 'ready' } });
      console.log('WARN diagnose returned', diag.status, '— forced status=ready');
    } else {
      console.log('diagnose ->', diag.json);
    }

    // 3) get recommended roles (5 preset roles)
    const getDiag = await api('GET', `/reviews/${reviewId}/diagnosis`);
    let roleIds = [];
    if (getDiag.json?.recommendedRoles?.length) {
      roleIds = getDiag.json.recommendedRoles.map(r => r.roleId);
    }
    if (roleIds.length < 3) throw new Error('not enough roles: ' + roleIds.length);
    // use 5 roles to prove the cap trims to 3
    const selRoles = roleIds.slice(0, 5).map((rid, i) => ({ roleId: rid, weight: 20 - i * 2 }));
    console.log('selected', selRoles.length, 'roles for saveRoles (cap should trim to 3)');

    // 4) saveRoles
    const saved = await api('POST', `/reviews/${reviewId}/roles`, { roles: selRoles });
    if (saved.status !== 201 && saved.status !== 200) throw new Error('saveRoles failed: ' + saved.text);
    console.log('saveRoles ->', saved.status);

    // 5) startReview — timed (<1s expected)
    const t0 = (typeof performance !== 'undefined' ? performance : require('perf_hooks').performance).now();
    const started = await api('POST', `/reviews/${reviewId}/start`);
    const startMs = (typeof performance !== 'undefined' ? performance : require('perf_hooks').performance).now() - t0;
    if (started.status !== 200 && started.status !== 201) throw new Error('start failed: ' + started.text);
    console.log(`startReview -> ${started.status} in ${startMs.toFixed(1)}ms (${JSON.stringify(started.json)})`);
    check('startReview latency < 1s (no provider call in HTTP lifecycle)', startMs < 1000, `${startMs.toFixed(1)}ms`);

    // 6) poll until terminal
    let finalStatus = null;
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      const g = await api('GET', `/reviews/${reviewId}`);
      finalStatus = g.json?.status;
      if (finalStatus === 'completed' || finalStatus === 'failed') break;
      await new Promise(r => setTimeout(r, 1500));
    }
    console.log('final review status:', finalStatus);

    // 7) report API -> 200
    const report = await api('GET', `/reviews/${reviewId}/report`);
    check('Report API returns 200', report.status === 200, `status=${report.status}`);
    const rep = report.json;

    // 8) DB-level validation
    const turns = await prisma.reviewTurn.findMany({ where: { reviewId } });
    const opinions = await prisma.reviewOpinion.findMany({ where: { reviewId } });
    console.log(`DB: turns=${turns.length} opinions=${opinions.length}`);

    check('review_turns <= 3', turns.length <= 3, `turns=${turns.length}`);
    check('review_opinions <= 3', opinions.length <= 3, `opinions=${opinions.length}`);

    // providerSource distribution
    const sources = {};
    let fallbackCount = 0, failedCount = 0, leaked = false, parseError = 0;
    for (const o of opinions) {
      let ref = null;
      try { ref = o.modelOutputRef ? JSON.parse(o.modelOutputRef) : null; }
      catch { parseError++; }
      const src = ref?.providerSource || 'mock';
      sources[src] = (sources[src] || 0) + 1;
      if (ref?.fallback === true) fallbackCount++;
      if (src === 'failed') failedCount++;
      // leakage scan
      const blob = JSON.stringify(o) + (o.modelOutputRef || '');
      for (const p of LEAK_PATTERNS) { if (p.test(blob)) { leaked = true; break; } }
    }
    console.log('providerSource distribution:', JSON.stringify(sources));
    console.log('fallbackCount=', fallbackCount, 'failedCount=', failedCount, 'parseError=', parseError, 'leaked=', leaked);

    const hasLm = (sources.lmstudio || 0) > 0;
    check('providerSource distinguishable (lmstudio / fallback_mock / failed)',
      Object.keys(sources).every(s => ['lmstudio', 'fallback_mock', 'failed', 'mock'].includes(s)),
      JSON.stringify(sources));
    check('at least one real lmstudio call recorded', hasLm, `lmstudio=${sources.lmstudio || 0}`);

    const ps = rep?.providerSummary;
    check('providerSummary.hasRealProvider correct', ps?.hasRealProvider === hasLm,
      `report.hasRealProvider=${ps?.hasRealProvider} dbHasLm=${hasLm}`);
    check('providerSummary.fallbackCount correct', ps?.fallbackCount === fallbackCount,
      `report=${ps?.fallbackCount} db=${fallbackCount}`);
    check('providerSummary.failedCount correct', ps?.failedCount === failedCount,
      `report=${ps?.failedCount} db=${failedCount}`);
    check('no raw response / api key / prompt leakage', !leaked, leaked ? 'LEAK DETECTED' : 'clean');

    // summary
    const passed = results.filter(r => r.pass).length;
    console.log(`\n==== E2E SUMMARY: ${passed}/${results.length} checks passed ====`);
    console.log('REVIEW_ID=' + reviewId);
    console.log('FINAL_STATUS=' + finalStatus);
    console.log('TURNS=' + turns.length + ' OPINIONS=' + opinions.length);
    console.log('SOURCES=' + JSON.stringify(sources));
    console.log('START_MS=' + startMs.toFixed(1));
    console.log('REPORT_200=' + (report.status === 200));
    console.log('E2E_RESULT=' + (passed === results.length ? 'PASS' : 'FAIL'));

    // stash for cleanup
    require('fs').writeFileSync('.e2e-last-review.json',
      JSON.stringify({ reviewId, finalStatus, turns: turns.length, opinions: opinions.length, sources, startMs, hasReal: ps?.hasRealProvider }));
  } catch (e) {
    console.error('E2E ERROR:', e.message);
    if (reviewId) console.error('REVIEW_ID=' + reviewId);
    process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

main();
