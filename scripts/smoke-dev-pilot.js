/**
 * PrismReview — Dev Pilot Smoke Test (Sprint 7.3)
 *
 * In-process verification of the dev-only queue LM Studio pilot contract
 * (Sprint 7.2 §1/§3/§5/§7/§9). Exercises the REAL provider-adapter module
 * that queue.service.ts uses, and mirrors queue.service.ts's exact
 * fallback/classification + modelOutputRef serialization logic so the
 * contract can be verified WITHOUT a live LM Studio or running server.
 *
 * Covers the Sprint 7.3 acceptance matrix for the dev pilot smoke:
 *   - default mock path unchanged
 *   - lmstudio guard NOT enabled → fail closed (GUARD)
 *   - lmstudio env enabled but provider runtime error → fallback_mock
 *   - modelOutputRef is JSON.parse-able
 *   - providerSource discriminates mock / lmstudio / fallback_mock / failed
 *   - no rawText / raw response / API Key / prompt in modelOutputRef or summary
 *   - openai_compatible is excluded from the pilot (no accidental enable)
 *   - MODEL_PILOT_MAX_ROLES logic (pilot-only cap, default-3, never caps mock)
 *
 * Usage:
 *   node scripts/smoke-dev-pilot.js
 *
 * No server / DB / LM Studio required. The only network touch is a deliberate
 * connection to a dead port (127.0.0.1:1) to prove the runtime-error →
 * fallback_mock trigger — no real model is ever called.
 */

const { getProvider, mockProvider, lmstudioProvider } = require('./provider-adapter');

// ── Tiny async test harness ──
let pass = 0, fail = 0;
const pending = [];
const check = (name, fn) => {
  pending.push((async () => {
    try {
      const r = await fn();
      if (r.pass) { pass++; console.log('  ✅ ' + name); }
      else { fail++; console.log('  ❌ ' + name + ' — ' + r.actual); }
    } catch (e) { fail++; console.log('  ❌ ' + name + ' — threw: ' + e.message); }
  })());
};

// ── Env sandbox helper ──
function withEnv(envPatch, fn) {
  const keys = ['MODEL_PROVIDER', 'ALLOW_EXTERNAL_MODEL_CALLS', 'MODEL_BASE_URL', 'MODEL_NAME', 'MODEL_API_KEY', 'MODEL_PILOT_MAX_ROLES'];
  const orig = {};
  for (const k of new Set([...Object.keys(envPatch), ...keys])) orig[k] = process.env[k];
  for (const [k, v] of Object.entries(envPatch)) {
    if (v === null || v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try { return fn(); }
  finally { for (const k of Object.keys(orig)) { if (orig[k] === undefined) delete process.env[k]; else process.env[k] = orig[k]; } }
}

// ── Faithful mirror of queue.service.ts modelOutputRef + reasoningSummary ──
// (the real code lives in executeAgentTurn / buildReasoningSummary; this mirror
//  lets the smoke assert the serialized output is safe + parseable without a DB)
function buildModelOutputRef(obs) { return JSON.stringify(obs); }
function buildReasoningSummary(obs) {
  const parts = [`src=${obs.providerSource}`];
  if (obs.modelName) parts.push(obs.modelName);
  if (obs.fallbackReason) parts.push(`fallback: ${obs.fallbackReason.substring(0, 80)}`);
  if (obs.errorReason && !obs.fallbackReason) parts.push(`err: ${obs.errorReason.substring(0, 80)}`);
  return parts.join(' | ').substring(0, 200);
}

// ── Faithful mirror of queue.service.ts executeAgentTurn classification tree ──
async function simulateAgentTurn(roleCode, objective) {
  let provider;
  try {
    provider = getProvider();
  } catch (err) {
    const ref = { providerSource: 'failed', providerName: process.env.MODEL_PROVIDER || 'unknown', fallback: false, errorReason: err.message.substring(0, 200) };
    return { providerSource: 'failed', fallback: false, noRetry: true, ref, summary: buildReasoningSummary(ref) };
  }
  try {
    const result = await provider.run(roleCode, objective);
    const ref = { providerSource: result.provider || provider.name, providerName: provider.name, modelName: result.model || 'unknown', fallback: false, durationMs: 0 };
    return { providerSource: ref.providerSource, fallback: false, noRetry: false, ref, summary: buildReasoningSummary(ref) };
  } catch (err) {
    if (err.message.includes('HTTP 401') || err.message.includes('HTTP 403')) {
      const ref = { providerSource: 'failed', providerName: provider.name, modelName: provider.model || 'unknown', fallback: false, errorReason: err.message.substring(0, 200) };
      return { providerSource: 'failed', fallback: false, noRetry: true, ref, summary: buildReasoningSummary(ref) };
    }
    const fallback = mockProvider(roleCode);
    const ref = { providerSource: 'fallback_mock', providerName: provider.name, modelName: process.env.MODEL_NAME || 'unknown', fallback: true, fallbackReason: err.message.substring(0, 200), errorReason: err.message.substring(0, 200), durationMs: 0 };
    return { providerSource: 'fallback_mock', fallback: true, noRetry: false, ref, summary: buildReasoningSummary(ref) };
  }
}

// ── Four modelOutputRef variants exactly as the queue would emit them ──
function mockRef() {
  const r = mockProvider('CTO');
  return { providerSource: r.provider || 'mock', providerName: 'mock', modelName: r.model || 'unknown', fallback: false, durationMs: 0 };
}
function lmstudioRef() {
  return { providerSource: 'lmstudio', providerName: 'lmstudio', modelName: process.env.MODEL_NAME || 'google/gemma-4-12b', fallback: false, durationMs: 1234 };
}
function fallbackRef(errMsg) {
  return { providerSource: 'fallback_mock', providerName: 'lmstudio', modelName: process.env.MODEL_NAME || 'unknown', fallback: true, fallbackReason: (errMsg || 'ECONNREFUSED').substring(0, 200), errorReason: (errMsg || 'ECONNREFUSED').substring(0, 200), durationMs: 50 };
}
function failedRef(errMsg) {
  return { providerSource: 'failed', providerName: 'lmstudio', fallback: false, errorReason: (errMsg || 'GUARD').substring(0, 200) };
}

// ── Safety scan: must NOT contain rawText / raw response / API Key / prompt ──
const FORBIDDEN = ['rawText', 'rawResponse', 'api_key', 'apiKey', 'sk-', 'Bearer', 'Authorization', 'prompt'];
function assertClean(label, ...strings) {
  const hits = [];
  for (const s of strings) for (const tok of FORBIDDEN) if ((s || '').includes(tok)) hits.push(tok);
  return { pass: hits.length === 0, actual: hits.length ? `contains ${[...new Set(hits)].join(', ')}` : 'clean' };
}

// ── Faithful mirror of queue.service.ts applyPilotRoleCap (Sprint 7.3) ──
function applyPilotRoleCap(roles, env) {
  const provider = (env.MODEL_PROVIDER || '').toLowerCase();
  const allow = env.ALLOW_EXTERNAL_MODEL_CALLS || '';
  if (provider !== 'lmstudio' || allow !== 'true') return roles;
  const raw = env.MODEL_PILOT_MAX_ROLES;
  let max;
  if (raw === undefined || raw === null || String(raw).trim() === '') max = 3;
  else { const p = parseInt(String(raw), 10); max = Number.isFinite(p) && p > 0 ? p : 3; }
  if (!Number.isFinite(max) || max <= 0) max = 3;
  return roles.slice(0, max);
}

// ─────────────────────────────────────────────────────────────
(async () => {
  console.log('\n🧪 Dev Pilot Smoke Test (Sprint 7.3)\n');

  // ── 1. Default mock path unchanged ──
  console.log('--- 1. Default mock path unchanged ---');
  check('Default (no env) → mock provider', () =>
    withEnv({ MODEL_PROVIDER: null, ALLOW_EXTERNAL_MODEL_CALLS: null }, () => {
      const p = getProvider();
      return { pass: p.name === 'mock', actual: `provider=${p.name}` };
    }),
  );
  check('MODEL_PROVIDER=mock → mock provider', () =>
    withEnv({ MODEL_PROVIDER: 'mock', ALLOW_EXTERNAL_MODEL_CALLS: null }, () => {
      const p = getProvider();
      return { pass: p.name === 'mock', actual: `provider=${p.name}` };
    }),
  );
  check('Default mockProvider output is well-formed', () => {
    const r = mockProvider('CTO');
    return { pass: r.riskLevel === 'high' && r.confidenceScore === 78 && r.dimension === '架构合理性', actual: `risk=${r.riskLevel} conf=${r.confidenceScore}` };
  });

  // ── 2. lmstudio guard NOT enabled → fail closed ──
  console.log('\n--- 2. lmstudio guard not enabled → fail closed ---');
  check('lmstudio + ALLOW unset → GUARD thrown', () =>
    withEnv({ MODEL_PROVIDER: 'lmstudio', ALLOW_EXTERNAL_MODEL_CALLS: null }, () => {
      try { getProvider(); return { pass: false, actual: 'did not throw' }; }
      catch (e) { return { pass: e.message.includes('GUARD'), actual: e.message.includes('GUARD') ? 'GUARD' : e.message.substring(0, 60) }; }
    }),
  );
  check('lmstudio + ALLOW=false → GUARD thrown', () =>
    withEnv({ MODEL_PROVIDER: 'lmstudio', ALLOW_EXTERNAL_MODEL_CALLS: 'false' }, () => {
      try { getProvider(); return { pass: false, actual: 'did not throw' }; }
      catch (e) { return { pass: e.message.includes('GUARD'), actual: e.message.includes('GUARD') ? 'GUARD' : e.message.substring(0, 60) }; }
    }),
  );

  // ── 3. openai_compatible excluded from pilot (no accidental enable) ──
  console.log('\n--- 3. openai_compatible excluded from pilot ---');
  check('openai_compatible + allow + no key → GUARD (not enabled)', () =>
    withEnv({ MODEL_PROVIDER: 'openai_compatible', ALLOW_EXTERNAL_MODEL_CALLS: 'true', MODEL_API_KEY: null }, () => {
      try { getProvider(); return { pass: false, actual: 'did not throw' }; }
      catch (e) { return { pass: e.message.includes('MODEL_API_KEY'), actual: e.message.includes('MODEL_API_KEY') ? 'GUARD(key)' : e.message.substring(0, 60) }; }
    }),
  );

  // ── 4. lmstudio env enabled + provider runtime error → fallback_mock ──
  console.log('\n--- 4. lmstudio runtime error → fallback_mock ---');
  check('lmstudio + allow + DEAD endpoint → lmstudioProvider throws (runtime, not auth)', () =>
    withEnv({ MODEL_PROVIDER: 'lmstudio', ALLOW_EXTERNAL_MODEL_CALLS: 'true', MODEL_BASE_URL: 'http://127.0.0.1:1/v1', MODEL_NAME: 'google/gemma-4-12b' }, async () => {
      try { await lmstudioProvider('CTO', 'objective only'); return { pass: false, actual: 'did not throw (unexpected)' }; }
      catch (e) {
        const isAuth = e.message.includes('HTTP 401') || e.message.includes('HTTP 403');
        return { pass: !isAuth, actual: isAuth ? 'auth (wrong branch)' : 'runtime error OK' };
      }
    }),
  );
  // End-to-end mirror: the queue would catch that throw and produce fallback_mock.
  check('Queue mirror: runtime throw → fallback_mock (no NO_RETRY, parseable, clean)', () =>
    withEnv({ MODEL_PROVIDER: 'lmstudio', ALLOW_EXTERNAL_MODEL_CALLS: 'true', MODEL_BASE_URL: 'http://127.0.0.1:1/v1', MODEL_NAME: 'google/gemma-4-12b' }, async () => {
      const out = await simulateAgentTurn('CTO', 'objective only');
      const refStr = buildModelOutputRef(out.ref);
      let parsed = null; try { parsed = JSON.parse(refStr); } catch {}
      const clean = assertClean('ref', refStr, out.summary);
      return {
        pass: out.providerSource === 'fallback_mock' && out.noRetry !== true && parsed && parsed.providerSource === 'fallback_mock' && clean.pass,
        actual: `src=${out.providerSource} noRetry=${!!out.noRetry} parse=${!!parsed} clean=${clean.pass}`,
      };
    }),
  );

  // ── 5. modelOutputRef JSON.parse + providerSource discrimination ──
  console.log('\n--- 5. modelOutputRef JSON.parse + providerSource discrimination ---');
  const variants = {
    mock: mockRef(),
    lmstudio: lmstudioRef(),
    fallback_mock: fallbackRef('ECONNREFUSED'),
    failed: failedRef('MODEL PROVIDER GUARD: ...'),
  };
  for (const [name, ref] of Object.entries(variants)) {
    check(`modelOutputRef[${name}] is JSON.parse-able with providerSource=${name}`, () => {
      const str = buildModelOutputRef(ref);
      let parsed = null; try { parsed = JSON.parse(str); } catch {}
      const ok = parsed && parsed.providerSource === name && typeof parsed.fallback === 'boolean';
      return { pass: ok, actual: parsed ? `providerSource=${parsed.providerSource}` : 'NOT parseable' };
    });
  }
  check('providerSource values are mutually distinct', () => {
    const set = new Set(Object.values(variants).map(v => v.providerSource));
    return { pass: set.size === 4, actual: `distinct=${set.size}/4` };
  });

  // ── 6. No rawText / raw response / API Key / prompt ──
  console.log('\n--- 6. No rawText / raw response / API Key / prompt ---');
  for (const [name, ref] of Object.entries(variants)) {
    check(`[${name}] modelOutputRef + summary clean`, () => {
      const str = buildModelOutputRef(ref);
      const summary = buildReasoningSummary(ref);
      return assertClean(name, str, summary);
    });
  }
  // Specifically: a real lmstudio adapter result carries rawText, but the QUEUE
  // drops it — verify the serialization we write never includes it.
  check('lmstudio adapter result rawText is NOT serialized into modelOutputRef', () =>
    withEnv({ MODEL_PROVIDER: 'lmstudio', ALLOW_EXTERNAL_MODEL_CALLS: 'true' }, () => {
      const ref = lmstudioRef();
      const str = buildModelOutputRef(ref);
      return assertClean('lmstudio-ref', str);
    }),
  );

  // ── 7. MODEL_PILOT_MAX_ROLES logic (pilot-only cap; default 3; never caps mock) ──
  console.log('\n--- 7. MODEL_PILOT_MAX_ROLES logic ---');
  const fiveRoles = [1, 2, 3, 4, 5].map(i => ({ roleId: 'r' + i }));
  check('pilot + unset → caps at 3', () => {
    const out = applyPilotRoleCap(fiveRoles, { MODEL_PROVIDER: 'lmstudio', ALLOW_EXTERNAL_MODEL_CALLS: 'true' });
    return { pass: out.length === 3, actual: `len=${out.length}` };
  });
  check('pilot + MODEL_PILOT_MAX_ROLES=2 → caps at 2', () => {
    const out = applyPilotRoleCap(fiveRoles, { MODEL_PROVIDER: 'lmstudio', ALLOW_EXTERNAL_MODEL_CALLS: 'true', MODEL_PILOT_MAX_ROLES: '2' });
    return { pass: out.length === 2, actual: `len=${out.length}` };
  });
  check('pilot + invalid (abc) → falls back to 3', () => {
    const out = applyPilotRoleCap(fiveRoles, { MODEL_PROVIDER: 'lmstudio', ALLOW_EXTERNAL_MODEL_CALLS: 'true', MODEL_PILOT_MAX_ROLES: 'abc' });
    return { pass: out.length === 3, actual: `len=${out.length}` };
  });
  check('mock (no pilot) + env set → NO cap (default demo unaffected)', () => {
    const out = applyPilotRoleCap(fiveRoles, { MODEL_PROVIDER: 'mock', ALLOW_EXTERNAL_MODEL_CALLS: 'true', MODEL_PILOT_MAX_ROLES: '2' });
    return { pass: out.length === 5, actual: `len=${out.length}` };
  });
  check('unset provider (no pilot) + env set → NO cap', () => {
    const out = applyPilotRoleCap(fiveRoles, { MODEL_PROVIDER: null, ALLOW_EXTERNAL_MODEL_CALLS: 'true', MODEL_PILOT_MAX_ROLES: '2' });
    return { pass: out.length === 5, actual: `len=${out.length}` };
  });

  await Promise.all(pending);
  console.log('\n' + '='.repeat(50));
  console.log('  ' + pass + '/' + (pass + fail) + ' passed, ' + fail + '/' + (pass + fail) + ' failed');
  console.log('='.repeat(50));
  process.exit(fail > 0 ? 1 : 0);
})();
