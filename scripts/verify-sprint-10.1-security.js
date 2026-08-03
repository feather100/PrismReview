
const BASE = 'http://localhost:4000';
const API = BASE + '/api';

const p = (url, opts = {}) =>
  new Promise((resolve) => {
    const u = new URL(url);
    const lib = require('http');
    const req = lib.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: opts.method || 'GET', headers: { 'Content-Type': 'application/json', ...opts.headers } },
      (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: tryJson(d) })); },
    );
    req.on('error', (e) => resolve({ status: 0, body: e.message }));
    if (opts.body) req.write(JSON.stringify(opts.body));
    req.end();
  });

const tryJson = (s) => { try { return JSON.parse(s); } catch { return s; } };

// Check if response contains a REAL leak (not just the word "apiKey" in "apiKeyMasked")
function hasRealKeyLeak(obj) {
  if (typeof obj === 'string') {
    // Check for sk- pattern or long base64 strings that look like keys
    return /sk-[a-zA-Z0-9]{20,}/.test(obj) || /^[A-Za-z0-9+/]{40,}={0,2}$/.test(obj);
  }
  if (typeof obj === 'object' && obj !== null) {
    for (const [k, v] of Object.entries(obj)) {
      // Skip masked fields
      if (k === 'apiKeyMasked' || k === 'hasApiKey') continue;
      if (k === 'apiKey' && typeof v === 'string' && v.length > 10) return true;
      if (hasRealKeyLeak(v)) return true;
    }
  }
  return false;
}

async function main() {
  console.log('=== Sprint 10.1 Provider Security Verification ===');
  let pass = 0, fail = 0;

  // Test 1: Create review WITHOUT provider (default mock)
  console.log('\nTest 1: Create review without provider (default mock)');
  const r1 = await p(API + '/reviews', {
    method: 'POST',
    body: { title: 'Test Review No Provider', objective: 'Verify default mock mode' },
  });
  console.log('  Status: ' + r1.status);
  console.log('  Has llmProviderId: ' + (r1.body.llmProviderId !== undefined));
  console.log('  providerConfig leaked: ' + JSON.stringify(r1.body).includes('providerConfig'));
  if (r1.status === 201 && !JSON.stringify(r1.body).includes('providerConfig')) { pass++; console.log('  PASS'); }
  else { fail++; console.log('  FAIL'); }

  // Test 2: Create review with llmProviderId = invalid UUID (should be rejected by @IsUUID validator)
  console.log('\nTest 2: Create review with invalid llmProviderId format');
  const r2 = await p(API + '/reviews', {
    method: 'POST',
    body: { title: 'Test Invalid Provider', objective: 'Should fail', llmProviderId: 'not-a-uuid' },
  });
  console.log('  Status: ' + r2.status);
  if (r2.status === 400) { pass++; console.log('  PASS (rejected with 400 by @IsUUID validator)'); }
  else { fail++; console.log('  FAIL (expected 400)'); }

  // Test 3: Create review with valid UUID but non-existent provider
  console.log('\nTest 3: Create review with valid UUID but non-existent provider');
  const r3 = await p(API + '/reviews', {
    method: 'POST',
    body: { title: 'Test Non-Existent Provider', objective: 'Should fail', llmProviderId: '00000000-0000-0000-0000-000000000000' },
  });
  console.log('  Status: ' + r3.status);
  if (r3.status === 404 || r3.status === 400) { pass++; console.log('  PASS (rejected with ' + r3.status + ')'); }
  else { fail++; console.log('  FAIL (expected 400 or 404, got ' + r3.status + ')'); }

  // Test 4: GET /api/llm-providers/status (no key leak, tenantId present)
  console.log('\nTest 4: GET /api/llm-providers/status (no key leak, tenantId present)');
  const r4 = await p(API + '/llm-providers/status');
  console.log('  Status: ' + r4.status);
  console.log('  hasActive: ' + r4.body.hasActive);
  console.log('  active.tenantId: ' + (r4.body.active && r4.body.active.tenantId ? 'present' : 'missing'));
  console.log('  hasRealKeyLeak: ' + hasRealKeyLeak(r4.body));
  if (r4.status === 200 && !hasRealKeyLeak(r4.body) && r4.body.active && r4.body.active.tenantId) { pass++; console.log('  PASS'); }
  else { fail++; console.log('  FAIL'); }

  // Test 5: Verify provider_config column is dropped from reviews
  console.log('\nTest 5: Verify provider_config column is dropped from reviews');
  const r5 = await p(API + '/reviews');
  const r5str = JSON.stringify(r5.body);
  console.log('  Contains provider_config: ' + r5str.includes('provider_config'));
  if (!r5str.includes('provider_config')) { pass++; console.log('  PASS'); }
  else { fail++; console.log('  FAIL'); }

  console.log('\n=== Results: ' + pass + ' passed, ' + fail + ' failed ===');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
