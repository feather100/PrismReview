/**
 * PrismReview — Runtime Smoke Test (Sprint 1.3)
 *
 * Verifies core API endpoints including full Role Selection Submit Flow
 * and Meeting SSE Stream contract.
 *
 * Usage:
 *   node scripts/smoke-runtime.js
 *   node scripts/smoke-runtime.js --base http://my-host:4000
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

/** Connect to an SSE endpoint and return collected text. */
const fetchSSE = (url, timeoutMs = 8000) =>
  new Promise((resolve) => {
    const u = new URL(url);
    let resolved = false;
    let allData = '';
    let statusCode = 0;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        // req.destroy triggers 'close' which also calls resolve,
        // but after the destroy the body might be incomplete.
        // Since we've timed out, report what we have.
        resolve({ status: statusCode || 0, body: allData || 'TIMEOUT' });
      }
    }, timeoutMs);

    const req = require('http').get(
      { hostname: u.hostname, port: u.port, path: u.pathname },
      (res) => {
        statusCode = res.statusCode;
        res.on('data', (chunk) => { allData += chunk.toString(); });
        res.on('end', () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            resolve({ status: statusCode, body: allData });
          }
        });
        res.on('close', () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            resolve({ status: statusCode, body: allData });
          }
        });
      },
    );
    req.on('error', (e) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve({ status: 0, body: e.message });
      }
    });
  });

const tryJson = (s) => { try { return JSON.parse(s); } catch { return s; } };

let pass = 0, fail = 0;

const check = async (name, fn) => {
  try {
    const r = await fn();
    if (r.pass) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name} — expected ${r.expected}, got ${r.actual}`); }
    return r;
  } catch (e) {
    fail++;
    console.log(`  ❌ ${name} — threw: ${e.message}`);
    return { pass: false, error: e };
  }
};

(async () => {
  console.log(`\n🔍 PrismReview Runtime Smoke Test (Sprint 1.3)`);
  console.log(`   Base: ${BASE_URL}\n`);

  // 1. Auth
  await check('1. GET /api/auth/me returns 200', async () => {
    const r = await p(`${API}/auth/me`);
    return { pass: r.status === 200 && r.body?.id, expected: 200, actual: r.status };
  });

  // 2. Roles list
  const rolesResp = await check('2. GET /api/roles returns 5 preset roles', async () => {
    const r = await p(`${API}/roles`);
    if (r.status === 200 && Array.isArray(r.body) && r.body.length === 5) return { pass: true, data: r.body };
    return { pass: false, expected: '200 + 5 roles', actual: `${r.status} + ${r.body?.length ?? 0} roles` };
  });
  const allRoles = rolesResp.data || [];

  // 3-5. Invalid UUID plumbing
  await check('3. GET /api/roles/not-a-uuid returns 400', async () => {
    const r = await p(`${API}/roles/not-a-uuid`);
    return { pass: r.status === 400, expected: 400, actual: r.status };
  });
  await check('4. GET /api/knowledge/documents/bad-id returns 400', async () => {
    const r = await p(`${API}/knowledge/documents/bad-id`);
    return { pass: r.status === 400, expected: 400, actual: r.status };
  });
  await check('5. PATCH /api/knowledge/chunks/bad/review-status returns 400', async () => {
    const r = await p(`${API}/knowledge/chunks/bad/review-status`, { method: 'PATCH', body: { reviewStatus: 'approved' } });
    return { pass: r.status === 400, expected: 400, actual: r.status };
  });

  // 6. Create primary review
  const createResp = await check('6. POST /api/reviews returns 201 with id', async () => {
    const r = await p(`${API}/reviews`, { method: 'POST', body: { title: 'Smoke Meeting Flow', objective: 'Test meeting stream' } });
    if (r.status === 201 && r.body?.id) return { pass: true, data: r.body.id };
    return { pass: false, expected: '201 + id', actual: `${r.status} + ${r.body?.id ?? 'no id'}` };
  });
  const rid1 = createResp.data || '';
  if (!rid1) { fail++; console.log(`  ❌ Cannot continue without reviewId — aborting`); process.exit(1); }

  // 7-12. Diagnose → save roles → start
  await check('7. POST /reviews/{id}/diagnose returns 201', async () => {
    const r = await p(`${API}/reviews/${rid1}/diagnose`, { method: 'POST' });
    return { pass: r.status === 201, expected: 201, actual: r.status };
  });

  const diagResp = await check('8. GET /reviews/{id}/diagnosis returns diagnosis with recommendedRoles', async () => {
    const r = await p(`${API}/reviews/${rid1}/diagnosis`);
    const ok = r.status === 200 && r.body?.confidenceScore > 0 && Array.isArray(r.body?.recommendedRoles) && r.body.recommendedRoles.length >= 2;
    if (ok) return { pass: true, data: r.body };
    return { pass: false, expected: '200 + confidenceScore + recommendedRoles[]', actual: `${r.status} + confidence=${r.body?.confidenceScore} + roles=${r.body?.recommendedRoles?.length ?? 0}` };
  });
  const diagnosis = diagResp.data || {};
  const recommended = diagnosis.recommendedRoles || [];
  const rolesToSave = recommended.slice(0, 3).map((r) => ({ roleId: r.roleId, weight: r.weight }));
  if (rolesToSave.length < 2) { fail++; console.log(`  ❌ Not enough recommendedRoles`); process.exit(1); }

  await check('9. POST /reviews/{id}/roles saves role selection', async () => {
    const r = await p(`${API}/reviews/${rid1}/roles`, { method: 'POST', body: { roles: rolesToSave } });
    const ok = r.status === 201 && r.body?.roles?.length >= 2 && r.body.roles.every((rr) => rr.roleCode && rr.roleName);
    return { pass: ok, expected: '201 + >=2 enriched roles', actual: `${r.status} + ${r.body?.roles?.length ?? 0} roles${r.body?.roles?.[0]?.roleCode ? ' + enriched' : ''}` };
  });

  await check('10. GET /roles?available_for_review={id} excludes saved roles', async () => {
    const r = await p(`${API}/roles?available_for_review=${rid1}`);
    return { pass: r.status === 200 && Array.isArray(r.body) && r.body.length < allRoles.length, expected: `${allRoles.length - rolesToSave.length} available`, actual: `${r.body?.length ?? 0} available` };
  });

  await check('11. POST /reviews/{id}/start starts review', async () => {
    const r = await p(`${API}/reviews/${rid1}/start`, { method: 'POST' });
    const ok = r.status === 201 && r.body?.status === 'running' && r.body?.sessionId;
    return { pass: ok, expected: '201 + status=running + sessionId', actual: `${r.status} + status=${r.body?.status} + sessionId=${r.body?.sessionId ? 'present' : 'missing'}` };
  });

  await check('12. POST /reviews/{id}/roles after start returns 400', async () => {
    const r = await p(`${API}/reviews/${rid1}/roles`, { method: 'POST', body: { roles: rolesToSave } });
    return { pass: r.status === 400, expected: 400, actual: r.status };
  });

  // ── Meeting Stream Tests ──
  // Note: @Sse() endpoints always return HTTP 200 even on errors.
  // Errors are sent as SSE event: error lines. We check body content instead.

  // 13. Connect to running review's meeting stream, verify event sequence
  await check('13. GET /reviews/{id}/meeting/stream returns valid events', async () => {
    const r = await fetchSSE(`${API}/reviews/${rid1}/meeting/stream`, 10000);
    const b = r.body;
    const hasStarted = b.includes('meeting.started');
    const hasHeartbeat = b.includes('heartbeat');
    const hasTurnStarted = b.includes('agent.turn.started');
    const hasMsgCompleted = b.includes('agent.message.completed');
    const hasTurnCompleted = b.includes('agent.turn.completed');
    const hasCompleted = b.includes('meeting.completed');
    const turnCount = (b.match(/"agent\.turn\.started"/g) || []).length;
    const isError = b.includes('event: error');
    const ok = !isError && hasStarted && hasHeartbeat && hasTurnStarted && hasMsgCompleted && hasTurnCompleted && hasCompleted && turnCount >= 2;
    return {
      pass: ok,
      expected: 'no error + meeting.started + heartbeat + >=2 turns + msg.completed + turn.completed + meeting.completed',
      actual: isError ? 'SSE error' : `${hasStarted ? 'start' : 'no-start'} ${hasHeartbeat ? 'hb' : 'no-hb'} ${turnCount}turns ${hasMsgCompleted ? 'msg' : 'no-msg'} ${hasCompleted ? 'completed' : 'no-completed'}`,
    };
  });

  // 14. Invalid UUID → SSE error event
  await check('14. GET /reviews/invalid-uuid/meeting/stream returns SSE error', async () => {
    const r = await fetchSSE(`${API}/reviews/invalid-uuid/meeting/stream`, 3000);
    return { pass: r.body.includes('event: error'), expected: 'SSE event: error', actual: r.body.includes('event: error') ? 'error' : r.body.substring(0, 60) };
  });

  // 15. Valid UUID non-existent → SSE error event
  await check('15. GET /reviews/12345678-1234-4234-8234-123456789abc/meeting/stream returns SSE error', async () => {
    const r = await fetchSSE(`${API}/reviews/12345678-1234-4234-8234-123456789abc/meeting/stream`, 3000);
    return { pass: r.body.includes('event: error'), expected: 'SSE event: error', actual: r.body.includes('event: error') ? 'error' : r.body.substring(0, 60) };
  });

  // ── Report Tests ──

  // 16. Running review returns report with full fields
  await check('16. GET /reviews/{id}/report returns report', async () => {
    const r = await p(`${API}/reviews/${rid1}/report`);
    const sourceOk = r.body?.source === 'mock_fallback' || r.body?.source === 'db_opinions';
    const ps = r.body?.providerSummary;
    const psOk = ps && typeof ps.totalTurns === 'number' && typeof ps.fallbackCount === 'number' && typeof ps.failedCount === 'number' && Array.isArray(ps.models) && typeof ps.hasRealProvider === 'boolean';
    const ok = r.status === 200 && r.body?.reviewId && r.body?.verdict && sourceOk && psOk && Array.isArray(r.body?.risks) && Array.isArray(r.body?.opinions) && Array.isArray(r.body?.actionItems);
    return { pass: ok, expected: '200 + source=(mock_fallback|db_opinions) + providerSummary + verdict + ...', actual: `${r.status} + source=${r.body?.source} ps=${psOk ? 'ok' : 'missing'} ${r.body?.verdict || 'no-verdict'} risks=${r.body?.risks?.length ?? 0}` };
  });

  // 17. Invalid UUID → 400
  await check('17. GET /reviews/invalid-uuid/report returns 400', async () => {
    const r = await p(`${API}/reviews/invalid-uuid/report`);
    return { pass: r.status === 400, expected: 400, actual: r.status };
  });

  // 18. Non-existent valid UUID → 404
  await check('18. GET /reviews/12345678-1234-4234-8234-123456789abc/report returns 404', async () => {
    const r = await p(`${API}/reviews/12345678-1234-4234-8234-123456789abc/report`);
    return { pass: r.status === 404, expected: 404, actual: r.status };
  });

  // 19. Create third review, diagnose only (not started), report must fail
  const create3 = await check('19. POST /api/reviews (third, not started) returns 201', async () => {
    const r = await p(`${API}/reviews`, { method: 'POST', body: { title: 'Report Not Started', objective: 'Test report blocks on draft/ready' } });
    if (r.status === 201 && r.body?.id) return { pass: true, data: r.body.id };
    return { pass: false, expected: '201 + id', actual: `${r.status} + ${r.body?.id ?? 'no id'}` };
  });
  const rid3 = create3.data || '';
  if (rid3) {
    await check('20. POST /reviews/{id}/diagnose (third) returns 201', async () => {
      const r = await p(`${API}/reviews/${rid3}/diagnose`, { method: 'POST' });
      return { pass: r.status === 201, expected: 201, actual: r.status };
    });
    await check('21. GET /reviews/{id}/report (not started) returns 400', async () => {
      const r = await p(`${API}/reviews/${rid3}/report`);
      return { pass: r.status === 400, expected: 400, actual: r.status };
    });
  }

  // ── Second review: test error paths ──

  // 19. Create second review (no roles saved)
  const create2 = await check('16. POST /api/reviews (second) returns 201', async () => {
    const r = await p(`${API}/reviews`, { method: 'POST', body: { title: 'Smoke No Roles', objective: 'Test error cases' } });
    if (r.status === 201 && r.body?.id) return { pass: true, data: r.body.id };
    return { pass: false, expected: '201 + id', actual: `${r.status} + ${r.body?.id ?? 'no id'}` };
  });
  const rid2 = create2.data || '';

  if (rid2) {
    // 20. Diagnose second review
    await check('20. POST /reviews/{id}/diagnose (second) returns 201', async () => {
      const r = await p(`${API}/reviews/${rid2}/diagnose`, { method: 'POST' });
      return { pass: r.status === 201, expected: 201, actual: r.status };
    });

    // 21. Start without roles → 400
    await check('21. POST /reviews/{id}/start without roles returns 400', async () => {
      const r = await p(`${API}/reviews/${rid2}/start`, { method: 'POST' });
      return { pass: r.status === 400, expected: 400, actual: r.status };
    });

    // 22. Non-running review meeting stream → SSE error
    await check('22. GET /reviews/{id}/meeting/stream (non-running) returns SSE error', async () => {
      const r = await fetchSSE(`${API}/reviews/${rid2}/meeting/stream`, 3000);
      return { pass: r.body.includes('event: error'), expected: 'SSE event: error', actual: r.body.includes('event: error') ? 'error' : r.body.substring(0, 60) };
    });
  }

  // 23. Invalid reviewId (diagnosis) → 400
  await check('23. GET /reviews/invalid-uuid/diagnosis returns 400', async () => {
    const r = await p(`${API}/reviews/invalid-uuid/diagnosis`);
    return { pass: r.status === 400, expected: 400, actual: r.status };
  });

  // 24. Valid UUID v4 but non-existent (diagnosis) → 404
  await check('24. GET /reviews/12345678-1234-4234-8234-123456789abc/diagnosis returns 404', async () => {
    const r = await p(`${API}/reviews/12345678-1234-4234-8234-123456789abc/diagnosis`);
    return { pass: r.status === 404, expected: 404, actual: r.status };
  });

  // ── Review List API Tests ──

  await check('25. GET /api/reviews returns paginated list', async () => {
    const r = await p(`${API}/reviews`);
    const ok = r.status === 200 && Array.isArray(r.body?.items) && typeof r.body?.total === 'number' && typeof r.body?.limit === 'number' && typeof r.body?.offset === 'number';
    return { pass: ok, expected: '200 + items[] + total + limit + offset', actual: r.status + ' items=' + (r.body?.items?.length ?? 0) + ' total=' + r.body?.total };
  });

  await check('26. GET /api/reviews?status=running filters correctly', async () => {
    const r = await p(`${API}/reviews?status=running`);
    const allRunning = Array.isArray(r.body?.items) && r.body.items.every(i => i.status === 'running');
    return { pass: r.status === 200 && allRunning, expected: '200 + all items status=running', actual: r.status + ' items=' + (r.body?.items?.length ?? 0) };
  });

  await check('27. GET /api/reviews?limit=999 returns 400', async () => {
    const r = await p(`${API}/reviews?limit=999`);
    return { pass: r.status === 400, expected: 400, actual: r.status };
  });

  await check('28. GET /api/reviews?offset=-1 returns 400', async () => {
    const r = await p(`${API}/reviews?offset=-1`);
    return { pass: r.status === 400, expected: 400, actual: r.status };
  });

  // ── Summary ──
  const total = pass + fail;
  console.log(`\n${'='.repeat(50)}`);
  console.log(`  ${pass}/${total} passed, ${fail}/${total} failed`);
  console.log(`${'='.repeat(50)}`);
  process.exit(fail > 0 ? 1 : 0);
})();
