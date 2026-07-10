/**
 * PrismReview — Runner Smoke Test (Sprint 2.0)
 *
 * Verifies the agent turn runner works correctly:
 * - Runs 3 mock turns on a running review
 * - Checks review_turns are created
 * - Checks review_opinions are created
 * - Checks idempotent skip
 * - Checks report reads from DB
 *
 * Usage: node scripts/smoke-runner.js
 */

const BASE = 'http://localhost:4000/api';

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
  require('child_process').exec(cmd, { cwd: process.cwd(), timeout: 30000 }, (err, stdout, stderr) => {
    resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
  });
});

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try {
    const r = await fn();
    if (r.pass) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name} — ${r.actual}`); }
    return r;
  } catch (e) { fail++; console.log(`  ❌ ${name} — threw: ${e.message}`); return { pass: false }; }
};

(async () => {
  console.log(`\n🧪 Runner Smoke Test\n`);

  // 1. Create a running review via API
  const c = await p(`${BASE}/reviews`, { method: 'POST', body: { title: 'Runner Smoke', objective: 'Test runner script' } });
  const rid = c.body?.id;
  if (!rid) { console.log('❌ Cannot create review'); process.exit(1); }
  console.log(`   Review: ${rid.substring(0, 8)}...`);

  await p(`${BASE}/reviews/${rid}/diagnose`, { method: 'POST' });
  const dx = await p(`${BASE}/reviews/${rid}/diagnosis`);
  const roles = dx.body?.recommendedRoles?.slice(0, 3).map(r => ({ roleId: r.roleId, weight: r.weight })) || [];
  await p(`${BASE}/reviews/${rid}/roles`, { method: 'POST', body: { roles } });
  await p(`${BASE}/reviews/${rid}/start`, { method: 'POST' });

  // 2. Run the agent turn runner
  const runner = await exec(`node scripts/run-agent-turns-for-review.js ${rid}`);
  await check('Runner exits with 0', () => ({ pass: runner.code === 0, actual: `exit ${runner.code}` }));
  await check('Runner prints 3/3 completed', () => ({ pass: runner.stdout.includes('3/3 turns completed'), actual: runner.stdout.split('\n').filter(l => l.includes('Turn')).join('; ') }));

  // 3. Check review was completed
  const rv = await p(`${BASE}/reviews/${rid}`);
  await check('Review status is completed', () => ({ pass: rv.body?.status === 'completed', actual: rv.body?.status }));

  // 4. Check report reads from DB
  const rp = await p(`${BASE}/reviews/${rid}/report`);
  const opinions = rp.body?.opinions || [];
  await check('Report has 3 opinions from DB', () => ({ pass: opinions.length === 3, actual: opinions.length + ' opinions' }));
  await check('Report source is db_opinions', () => ({ pass: rp.body?.source === 'db_opinions', actual: rp.body?.source }));
  await check('Report generatedFromTurns is true', () => ({ pass: rp.body?.generatedFromTurns === true, actual: String(rp.body?.generatedFromTurns) }));
  await check('Report has verdict', () => ({ pass: !!rp.body?.verdict, actual: rp.body?.verdict || 'none' }));

  // 5. Check idempotent — second run should skip gracefully
  const runner2 = await exec(`node scripts/run-agent-turns-for-review.js ${rid}`);
  await check('Second run skips (idempotent)', () => ({ pass: runner2.code === 0 && runner2.stdout.includes('Skipping'), actual: 'exit ' + runner2.code + (runner2.stdout.includes('Skipping') ? ' skipped' : ' no-skip') }));

  // Verify turn count didn't double
  const rp2 = await p(`${BASE}/reviews/${rid}/report`);
  await check('Opinion count unchanged after idempotent skip', () => ({ pass: rp2.body?.opinions?.length === 3, actual: rp2.body?.opinions?.length + ' opinions' }));

  // 6. Check --force re-runs correctly
  const runner3 = await exec(`node scripts/run-agent-turns-for-review.js ${rid} --force`);
  await check('--force re-runs all turns', () => ({ pass: runner3.code === 0 && runner3.stdout.includes('3/3 turns completed'), actual: 'exit ' + runner3.code }));

  // Verify still 3 opinions (not 6)
  const rp3 = await p(`${BASE}/reviews/${rid}/report`);
  await check('Opinion count still 3 after --force', () => ({ pass: rp3.body?.opinions?.length === 3, actual: rp3.body?.opinions?.length + ' opinions' }));

  // ── Wrapper smoke tests ──
  console.log('\n--- Wrapper Smoke Tests ---\n');

  const wrapper1 = await exec('node scripts/setup-demo-review.js --with-runner');
  await check('Wrapper fresh: contains "turns completed"', () => ({ pass: wrapper1.code === 0 && wrapper1.stdout.includes('turns completed'), actual: 'exit ' + wrapper1.code }));
  await check('Wrapper fresh: NOT "runner failed"', () => ({ pass: !wrapper1.stdout.includes('runner failed'), actual: !wrapper1.stdout.includes('runner failed') ? 'ok' : 'FAIL: contains runner failed' }));

  // Idempotent skip via wrapper --review-id (tests the wrapper's own skip branch)
  const match = wrapper1.stdout.match(/\/reviews\/([a-z0-9-]{36})/i);
  if (match) {
    const wrapperRid = match[1];
    const wrapper2 = await exec('node scripts/setup-demo-review.js --review-id=' + wrapperRid + ' --with-runner');
    await check('Wrapper --review-id: contains "idempotent skip"', () => ({ pass: wrapper2.code === 0 && wrapper2.stdout.includes('idempotent skip'), actual: 'exit ' + wrapper2.code + (wrapper2.stdout.includes('idempotent skip') ? ' idempotent skip' : ' MISSING') }));
    await check('Wrapper --review-id: NOT "runner failed"', () => ({ pass: !wrapper2.stdout.includes('runner failed'), actual: !wrapper2.stdout.includes('runner failed') ? 'ok' : 'FAIL' }));
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`  ${pass}/${pass + fail} passed, ${fail}/${pass + fail} failed`);
  console.log(`${'='.repeat(50)}`);
  process.exit(fail > 0 ? 1 : 0);
})();
