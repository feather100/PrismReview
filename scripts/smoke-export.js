/**
 * PrismReview — Markdown Export Smoke Test (Sprint 6.1)
 *
 * Verifies GET /api/reviews/{id}/report/export.md
 */

const BASE = 'http://localhost:4000/api';

const p = (url, opts = {}) => new Promise((resolve) => {
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

const httpGetRaw = (url) => new Promise((resolve) => {
  const u = new URL(url);
  require('http').get({ hostname: u.hostname, port: u.port, path: u.pathname + u.search }, (res) => {
    let d = ''; const headers = res.headers;
    res.on('data', (c) => (d += c));
    res.on('end', () => resolve({ status: res.statusCode, headers, body: d }));
  }).on('error', (e) => resolve({ status: 0, body: e.message }));
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tryJson = (s) => { try { return JSON.parse(s); } catch { return s; } };

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { const r = await fn(); if (r.pass) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + ' — ' + r.actual); } } catch (e) { fail++; console.log('  ❌ ' + name + ' — threw: ' + e.message); }
};

(async () => {
  console.log('\n🧪 Markdown Export Smoke Test (Sprint 6.1)\n');

  // Create a completed review via queue
  const c = await p(`${BASE}/reviews`, { method: 'POST', body: { title: 'Export Test', objective: 'Verify markdown export' } });
  const rid = c.body?.id;
  await p(`${BASE}/reviews/${rid}/diagnose`, { method: 'POST' });
  const dx = await p(`${BASE}/reviews/${rid}/diagnosis`);
  const roles = dx.body?.recommendedRoles?.slice(0, 3).map((r) => ({ roleId: r.roleId, weight: r.weight })) || [];
  await p(`${BASE}/reviews/${rid}/roles`, { method: 'POST', body: { roles } });
  await p(`${BASE}/reviews/${rid}/start`, { method: 'POST' });
  await sleep(4000);

  // Now export
  const r = await httpGetRaw(`${BASE}/reviews/${rid}/report/export.md`);

  await check('Status 200', () => ({ pass: r.status === 200, actual: 'status=' + r.status }));
  await check('Content-Type: text/markdown', () => ({ pass: (r.headers['content-type'] || '').includes('text/markdown'), actual: r.headers['content-type'] }));
  await check('Content-Disposition: attachment', () => ({ pass: (r.headers['content-disposition'] || '').includes('attachment'), actual: r.headers['content-disposition'] }));
  await check('Contains title', () => ({ pass: r.body.includes('Export Test'), actual: r.body.includes('Export Test') ? 'ok' : 'MISSING' }));
  await check('Contains objective', () => ({ pass: r.body.includes('Verify markdown export'), actual: r.body.includes('Verify') ? 'ok' : 'MISSING' }));
  await check('Contains verdict section', () => ({ pass: r.body.includes('## 评审结论'), actual: r.body.includes('## 评审结论') ? 'ok' : 'MISSING' }));
  await check('Contains generatedAt (ISO)', () => ({ pass: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(r.body), actual: /20\d{2}-/.test(r.body) ? 'ISO found' : 'NO ISO' }));
  await check('Not contain modelOutputRef', () => ({ pass: !r.body.includes('modelOutputRef'), actual: !r.body.includes('modelOutputRef') ? 'clean' : 'CONTAINS modelOutputRef' }));
  await check('Not contain rawText', () => ({ pass: !r.body.includes('rawText'), actual: !r.body.includes('rawText') ? 'clean' : 'CONTAINS rawText' }));
  await check('Not contain sk- (API key pattern)', () => ({ pass: !/sk-[a-zA-Z0-9]{4}/.test(r.body), actual: /sk-./.test(r.body) ? 'CONTAINS sk-' : 'clean' }));
  await check('Not contain prompt', () => ({ pass: !r.body.toLowerCase().includes('prompt'), actual: !r.body.toLowerCase().includes('prompt') ? 'clean' : 'CONTAINS prompt' }));
  await check('Not contain api_key', () => ({ pass: !r.body.toLowerCase().includes('api_key'), actual: !r.body.toLowerCase().includes('api_key') ? 'clean' : 'CONTAINS api_key' }));

  // Provider summary assertions (DB opinions path)
  await check('Contains provider summary section', () => ({ pass: r.body.includes('## 生成来源摘要'), actual: r.body.includes('## 生成来源摘要') ? 'ok' : 'MISSING' }));
  await check('Contains total turns', () => ({ pass: /- 总轮次: \d+/.test(r.body), actual: /总轮次/.test(r.body) ? 'ok' : 'MISSING' }));
  await check('Contains Mock count', () => ({ pass: /- Mock 生成: \d+/.test(r.body), actual: /Mock 生成/.test(r.body) ? 'ok' : 'MISSING' }));
  await check('Contains Fallback count', () => ({ pass: /- 回退 Mock: \d+/.test(r.body), actual: /回退 Mock/.test(r.body) ? 'ok' : 'MISSING' }));
  await check('Contains Failed count', () => ({ pass: /- 失败: \d+/.test(r.body), actual: /失败:/.test(r.body) ? 'ok' : 'MISSING' }));

  // Mock fallback path: completed review with no DB opinions
  console.log('\n--- Mock fallback path ---\n');
  const c3 = await p(`${BASE}/reviews`, { method: 'POST', body: { title: 'Mock Only Export', objective: 'Verify mock fallback path' } });
  const rid2 = c3.body?.id;
  await p(`${BASE}/reviews/${rid2}/diagnose`, { method: 'POST' });
  const dx2 = await p(`${BASE}/reviews/${rid2}/diagnosis`);
  const roles2 = dx2.body?.recommendedRoles?.slice(0, 2).map((r) => ({ roleId: r.roleId, weight: r.weight })) || [];
  await p(`${BASE}/reviews/${rid2}/roles`, { method: 'POST', body: { roles: roles2 } });
  await p(`${BASE}/reviews/${rid2}/start`, { method: 'POST' });
  await sleep(5000); // Wait for queue
  const rm = await httpGetRaw(`${BASE}/reviews/${rid2}/report/export.md`);
  await check('Mock path: Status 200', () => ({ pass: rm.status === 200, actual: 'status=' + rm.status }));
  await check('Mock path: Contains source info', () => ({ pass: rm.body.includes('数据来源'), actual: rm.body.includes('数据来源') ? 'ok' : 'MISSING' }));
  const c2 = await p(`${BASE}/reviews`, { method: 'POST', body: { title: 'Draft Export', objective: 'T' } });
  const r2 = await httpGetRaw(`${BASE}/reviews/${c2.body?.id}/report/export.md`);
  await check('Draft review returns 400', () => ({ pass: r2.status === 400, actual: 'status=' + r2.status }));

  // Test non-existent
  const r3 = await httpGetRaw(`${BASE}/reviews/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/report/export.md`);
  await check('Non-existent returns 404', () => ({ pass: r3.status === 404, actual: 'status=' + r3.status }));

  console.log('\n' + '='.repeat(50));
  console.log('  ' + pass + '/' + (pass + fail) + ' passed, ' + fail + '/' + (pass + fail) + ' failed');
  console.log('='.repeat(50));
  process.exit(fail > 0 ? 1 : 0);
})();
