#!/usr/bin/env node
/**
 * PrismReview — One-Click Demo Setup (Sprint 2.2)
 *
 * Creates a fully configured review for demos.
 * With --with-runner also runs agent turns so Report shows db_opinions.
 *
 * Usage:
 *   node scripts/setup-demo-review.js
 *   node scripts/setup-demo-review.js --with-runner
 *   node scripts/setup-demo-review.js --review-id=<id> --with-runner
 *   node scripts/setup-demo-review.js --title "My Demo" --objective "Evaluate proposal" --with-runner
 *   node scripts/setup-demo-review.js --base http://my-host:4000
 */

const BASE_URL = (process.argv.find(a => a.startsWith('--base=')) ?? '').replace('--base=', '') || 'http://localhost:4000';
const API = `${BASE_URL}/api`;
const WEB_URL = process.env.WEB_URL || 'http://localhost:3000';

const withRunner = process.argv.includes('--with-runner');
const getArg = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : undefined; };
const reviewIdFromArg = (process.argv.find(a => a.startsWith('--review-id=')) ?? '').replace('--review-id=', '') || undefined;
const title = getArg('--title') || 'PrismReview MVP Demo';
const objective = getArg('--objective') || 'Evaluate the proposed architecture for scalability, cost, and delivery risk';

const p = (url, opts = {}) =>
  new Promise((resolve) => {
    const u = new URL(url);
    const lib = url.startsWith('https') ? require('https') : require('http');
    const req = lib.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: opts.method || 'GET', headers: { 'Content-Type': 'application/json', ...opts.headers } },
      (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: tryJson(d) })); },
    );
    req.on('error', (e) => resolve({ status: 0, body: e.message }));
    if (opts.body) req.write(JSON.stringify(opts.body));
    req.end();
  });

const tryJson = (s) => { try { return JSON.parse(s); } catch { return s; } };

const exec = (cmd) => new Promise((resolve) => {
  require('child_process').exec(cmd, { cwd: process.cwd(), timeout: 60000 }, (err, stdout, stderr) => {
    resolve({ code: err ? (err.code || 1) : 0, stdout: stdout || '', stderr: stderr || '' });
  });
});

(async () => {
  console.log(`\n🎬 PrismReview — One-Click Demo Setup\n`);

  // If --review-id provided, use existing review for runner/report check only
  let reviewId, savedCodes = '', runnerResult = '';

  if (reviewIdFromArg) {
    reviewId = reviewIdFromArg;
    console.log(`  📋 Using existing review: ${reviewId.substring(0, 8)}...`);
    // Verify review exists
    const rv = await p(`${API}/reviews/${reviewId}`);
    if (rv.status !== 200) {
      console.error(`❌ Review not found: ${reviewId}`);
      process.exit(1);
    }
    const roles = await p(`${API}/reviews/${reviewId}/diagnosis`);
    const roleNames = roles.body?.recommendedRoles?.slice(0,3).map(r=>r.roleCode).join(', ') || 'N/A';
    savedCodes = roleNames;
    console.log(`  ✅ Existing review loaded — status: ${rv.body?.status}, roles: ${roleNames}`);
  } else {
    // 1. Create review
    const r1 = await p(`${API}/reviews`, { method: 'POST', body: { title, objective } });
    if (r1.status !== 201 || !r1.body?.id) {
      console.error('❌ FAIL: could not create review', r1.status, r1.body);
      process.exit(1);
    }
    reviewId = r1.body.id;
    console.log(`  ✅ Review created: "${title}"`);

    // 2. Diagnose
    const r2 = await p(`${API}/reviews/${reviewId}/diagnose`, { method: 'POST' });
    if (r2.status !== 201) {
      console.error('❌ FAIL: diagnose failed', r2.status, r2.body);
      process.exit(1);
    }
    const dx = await p(`${API}/reviews/${reviewId}/diagnosis`);
    console.log(`  ✅ Diagnosed — ${dx.body?.tags?.length || 0} tags, ${dx.body?.recommendedRoles?.length || 0} roles available`);

    // 3. Save 3 roles
    const roles = dx.body.recommendedRoles.slice(0, 3).map((r) => ({ roleId: r.roleId, weight: r.weight }));
    const r4 = await p(`${API}/reviews/${reviewId}/roles`, { method: 'POST', body: { roles } });
    savedCodes = r4.body?.roles?.map((r) => r.roleCode).join(', ') || 'unknown';
    console.log(`  ✅ Roles saved: ${savedCodes}`);

    // 4. Start review
    await p(`${API}/reviews/${reviewId}/start`, { method: 'POST' });
    console.log(`  ✅ Review started (status: running)`);
  }

  // 5. Optional runner
  if (withRunner) {
    console.log(`  ⏳ Running agent turns...`);
    const runner = await exec(`node scripts/run-agent-turns-for-review.js ${reviewId}`);
    if (runner.code === 0) {
      if (runner.stdout.includes('Skipping')) {
        runnerResult = 'idempotent skip (turns already completed)';
      } else if (runner.stdout.includes('turns completed')) {
        runnerResult = 'mock provider, turns completed';
      } else {
        runnerResult = 'runner exited normally';
      }
    } else {
      runnerResult = 'runner failed: ' + (runner.stderr || runner.stdout).substring(0, 60);
    }
    console.log(`  ✅ ${runnerResult}`);
  }

  // 6. Determine demo route
  const report = await p(`${API}/reviews/${reviewId}/report`);
  const reportSource = report.body?.source || 'unknown';

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  🎬 Demo Ready — Review ID: ${reviewId.substring(0, 8)}...`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  Diagnosis:   ${WEB_URL}/reviews/${reviewId}`);
  console.log(`  Meeting:     ${WEB_URL}/reviews/${reviewId}/meeting`);
  console.log(`  Report:      ${WEB_URL}/reviews/${reviewId}/report`);
  console.log(`  SSE Stream:  ${BASE_URL}/api/reviews/${reviewId}/meeting/stream`);
  console.log(`  API Detail:  ${BASE_URL}/api/reviews/${reviewId}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  Route:       ${withRunner ? 'B (runner + DB opinions)' : 'A (pure mock)'}`);
  console.log(`  Report src:  ${reportSource}`);
  console.log(`  Roles:       ${savedCodes}`);
  if (runnerResult) console.log(`  Runner:      ${runnerResult}`);
  console.log(`${'='.repeat(60)}\n`);
})();
