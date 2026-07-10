/**
 * PrismReview — Setup Meeting Review
 *
 * Creates a review, diagnoses it, saves roles, and starts it.
 * Outputs URLs for testing the meeting SSE stream.
 *
 * Usage:
 *   node scripts/setup-meeting-review.js
 *   node scripts/setup-meeting-review.js --base http://my-host:4000
 */

const BASE_URL = (process.argv.find(a => a.startsWith('--base=')) ?? '').replace('--base=', '') || 'http://localhost:4000';
const API = `${BASE_URL}/api`;

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

(async () => {
  console.log('Setting up a running review for meeting stream testing...\n');

  // 1. Create review
  const r1 = await p(`${API}/reviews`, {
    method: 'POST',
    body: { title: 'Meeting Stream Test', objective: 'Test the SSE meeting event contract' },
  });
  if (r1.status !== 201 || !r1.body?.id) {
    console.error('FAIL: could not create review', r1.status, r1.body);
    process.exit(1);
  }
  const reviewId = r1.body.id;
  console.log(`  ✅ Review created: ${reviewId}`);

  // 2. Diagnose
  const r2 = await p(`${API}/reviews/${reviewId}/diagnose`, { method: 'POST' });
  if (r2.status !== 201) {
    console.error('FAIL: diagnose failed', r2.status, r2.body);
    process.exit(1);
  }
  console.log(`  ✅ Diagnosed`);

  // 3. Get recommended roles
  const r3 = await p(`${API}/reviews/${reviewId}/diagnosis`);
  if (r3.status !== 200 || !r3.body?.recommendedRoles?.length) {
    console.error('FAIL: could not get diagnosis', r3.status, r3.body);
    process.exit(1);
  }
  const roles = r3.body.recommendedRoles.slice(0, 3).map((r) => ({ roleId: r.roleId, weight: r.weight }));
  console.log(`  ✅ Diagnosis loaded — ${r3.body.recommendedRoles.length} roles available, using ${roles.length}`);

  // 4. Save role selection
  const r4 = await p(`${API}/reviews/${reviewId}/roles`, { method: 'POST', body: { roles } });
  if (r4.status !== 201 || !r4.body?.roles?.length) {
    console.error('FAIL: could not save roles', r4.status, r4.body);
    process.exit(1);
  }
  const savedCodes = r4.body.roles.map((r) => r.roleCode).join(', ');
  console.log(`  ✅ Roles saved: ${savedCodes}`);

  // 5. Start review
  const r5 = await p(`${API}/reviews/${reviewId}/start`, { method: 'POST' });
  if (r5.status !== 201 || r5.body?.status !== 'running') {
    console.error('FAIL: could not start review', r5.status, r5.body);
    process.exit(1);
  }
  console.log(`  ✅ Review started (status: running)`);

  // Output
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Review ID:       ${reviewId}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  Meeting page:    http://localhost:3000/reviews/${reviewId}/meeting`);
  console.log(`  SSE stream:      ${BASE_URL}/api/reviews/${reviewId}/meeting/stream`);
  console.log(`  API detail:      ${BASE_URL}/api/reviews/${reviewId}`);
  console.log(`${'='.repeat(60)}\n`);
})();
