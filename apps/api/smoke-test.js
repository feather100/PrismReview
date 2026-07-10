const http = require('http');

const BASE = 'http://localhost:4000/api';

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function sseRequest(path, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const req = http.get(
      { hostname: url.hostname, port: url.port, path: url.pathname },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      },
    );
    req.on('error', reject);
    setTimeout(() => {
      req.destroy();
      resolve({ status: 0, body: 'TIMEOUT' });
    }, timeoutMs);
  });
}

async function main() {
  let passed = 0;
  let failed = 0;

  function check(name, ok, detail = '') {
    if (ok) {
      console.log(`  ✅ PASS${detail ? ' — ' + detail : ''}`);
      passed++;
    } else {
      console.log(`  ❌ FAIL${detail ? ' — ' + detail : ''}`);
      failed++;
    }
  }

  // 1
  console.log('\n=== 1. GET /api/auth/me ===');
  const r1 = await request('GET', '/auth/me');
  check('Auth', r1.status === 200 && r1.body.id, `id=${r1.body.id}, permissions=${r1.body.permissions?.length}`);

  // 2
  console.log('\n=== 2. GET /api/roles ===');
  const r2 = await request('GET', '/roles');
  check('Roles', r2.status === 200 && Array.isArray(r2.body) && r2.body.length === 5, `${r2.body.length} preset roles`);

  // 3
  console.log('\n=== 3. POST /api/reviews ===');
  const r3 = await request('POST', '/reviews', { title: 'Smoke Test', objective: 'Test review workflow' });
  const reviewId = r3.body?.id;
  check('Create review', r3.status === 201, `id=${reviewId?.substring(0, 8)}...`);

  if (!reviewId) {
    console.log('\n❌ Cannot continue without reviewId');
    process.exit(1);
  }

  // 4
  console.log('\n=== 4. POST /reviews/' + reviewId.substring(0, 8) + '/diagnose ===');
  const r4 = await request('POST', `/reviews/${reviewId}/diagnose`);
  check('Diagnose', r4.status === 201, `taskId=${r4.body?.taskId}`);

  // 5
  console.log('\n=== 5. GET /reviews/' + reviewId.substring(0, 8) + '/diagnosis ===');
  const r5 = await request('GET', `/reviews/${reviewId}/diagnosis`);
  check('Get diagnosis', r5.status === 200 && r5.body?.confidenceScore,
    `confidence=${r5.body?.confidenceScore}, tags=${r5.body?.tags?.length}, roles=${r5.body?.recommendedRoles?.length}`);

  // 6
  console.log('\n=== 6. GET /roles?available_for_review= ===');
  const r6 = await request('GET', `/roles?available_for_review=${reviewId}`);
  check('Available roles', r6.status === 200 && Array.isArray(r6.body),
    `${r6.body.length} roles available (0=all selected)`);

  // 7
  console.log('\n=== 7. POST /reviews/' + reviewId.substring(0, 8) + '/roles ===');
  // Get first 2 role IDs from the full list
  const roleList = Array.isArray(r2.body) ? r2.body : [];
  if (roleList.length >= 2) {
    const rolesPayload = {
      roles: [
        { roleId: roleList[0].id, weight: 60 },
        { roleId: roleList[1].id, weight: 40 },
      ],
    };
    const r7 = await request('POST', `/reviews/${reviewId}/roles`, rolesPayload);
    check('Save roles', r7.status === 201, `roleCount=${r7.body?.roles?.length}`);
  } else {
    check('Save roles', false, 'Not enough roles');
  }

  // 8
  console.log('\n=== 8. SSE /reviews/' + reviewId.substring(0, 8) + '/diagnose/stream ===');
  const r8 = await sseRequest(`/reviews/${reviewId}/diagnose/stream`);
  check('SSE stream', r8.body.includes('progress'), `received ${r8.body.length} chars`);

  // 9
  console.log('\n=== 9. POST /knowledge/documents ===');
  const r9 = await request('POST', '/knowledge/documents', {
    filename: 'test.md',
    content: '# Test Doc\n\nSample content for smoke testing.',
  });
  check('Upload doc', r9.status === 201 && r9.body?.chunkCount > 0,
    `chunks=${r9.body?.chunkCount}, status=${r9.body?.status}`);
  const docId = r9.body?.id;

  // 10
  console.log('\n=== 10. GET /knowledge/documents ===');
  const r10 = await request('GET', '/knowledge/documents');
  check('List docs', r10.status === 200 && Array.isArray(r10.body) && r10.body.length >= 1,
    `${r10.body.length} document(s)`);

  // 11
  console.log('\n=== 11. POST /knowledge/search-test ===');
  const r11 = await request('POST', '/knowledge/search-test', { query: 'test', topK: 3 });
  check('Search test', r11.status === 201 && Array.isArray(r11.body),
    `${r11.body.length} result(s)`);

  // Summary
  const total = passed + failed;
  console.log(`\n${'='.repeat(50)}`);
  console.log(`SMOKE TEST: ${passed}/${total} passed, ${failed}/${total} failed`);
  console.log(`${'='.repeat(50)}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
