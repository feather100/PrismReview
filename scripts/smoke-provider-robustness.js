/**
 * PrismReview — Provider Robustness Test (Sprint 4.6)
 *
 * Tests parse/normalize behavior of provider-adapter without real HTTP calls.
 */

const { stripMarkdown, normalizeParsed, mockProvider } = require('./provider-adapter');

let pass = 0, fail = 0;
const check = (name, fn) => {
  try {
    const r = fn();
    if (r.pass) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name} — ${r.actual}`); }
  } catch (e) { fail++; console.log(`  ❌ ${name} — threw: ${e.message}`); }
};

console.log('\n🧪 Provider Robustness Test (Sprint 4.6)\n');

// ── 1. Standard JSON ──
check('Standard JSON', () => {
  const p = normalizeParsed(JSON.parse(stripMarkdown('{"riskLevel":"high","dimension":"A","issue":"T","recommendation":"F","confidenceScore":80}')));
  return { pass: p && p.riskLevel === 'high', actual: 'risk=' + p.riskLevel };
});

// ── 2. Markdown fenced JSON ──
check('Markdown fenced JSON', () => {
  const p = normalizeParsed(JSON.parse(stripMarkdown('```json\n{"riskLevel":"medium","dimension":"S","issue":"T","recommendation":"F","confidenceScore":70}\n```')));
  return { pass: p && p.riskLevel === 'medium', actual: 'risk=' + p.riskLevel };
});

// ── 3. JSON array (first) ──
check('JSON array (first)', () => {
  const p = normalizeParsed(JSON.parse(stripMarkdown('[{"riskLevel":"low","dimension":"U","issue":"T","recommendation":"F","confidenceScore":60},{"riskLevel":"high"}]')));
  return { pass: p && p.riskLevel === 'low', actual: 'risk=' + p.riskLevel };
});

// ── 4. Uppercase RiskLevel (normalize preserves; provider lowercases) ──
check('Uppercase RiskLevel', () => {
  const p = normalizeParsed(JSON.parse(stripMarkdown('{"riskLevel":"HIGH","dimension":"A","issue":"T","recommendation":"F","confidenceScore":80}')));
  return { pass: p && p.riskLevel === 'HIGH', actual: 'risk=' + p.riskLevel };
});

// ── 5. CONFIDENCESCORE all-uppercase ──
check('CONFIDENCESCORE all-uppercase', () => {
  const p = normalizeParsed(JSON.parse(stripMarkdown('{"riskLevel":"medium","CONFIDENCESCORE":75,"dimension":"A","issue":"T","recommendation":"F"}')));
  return { pass: p && p.confidenceScore === 75, actual: 'conf=' + p.confidenceScore };
});

// ── 6. Empty content (Gemma reasoning scenario) ──
check('Empty content (unparseable)', () => {
  const cleaned = stripMarkdown('');
  let p = null;
  try { p = normalizeParsed(JSON.parse(cleaned)); } catch { /* expected */ }
  return { pass: !p, actual: p ? 'should have failed' : 'correctly failed' };
});

// ── 7. Non-JSON text ──
check('Non-JSON text', () => {
  let ok = false;
  try { JSON.parse(stripMarkdown('Hello world')); } catch { ok = true; }
  return { pass: ok, actual: ok ? 'correctly failed' : 'unexpectedly parsed' };
});

// ── 8. Missing riskLevel (normalize passes; provider checks) ──
check('Missing riskLevel', () => {
  const p = normalizeParsed(JSON.parse(stripMarkdown('{"dimension":"A","issue":"T"}')));
  return { pass: p && !p.riskLevel, actual: p ? ('risk=' + p.riskLevel) : 'null' };
});

// ── 9. Missing dimension (recoverable) ──
check('Missing dimension', () => {
  const p = normalizeParsed(JSON.parse(stripMarkdown('{"riskLevel":"high","issue":"T","recommendation":"F","confidenceScore":80}')));
  return { pass: p && p.riskLevel === 'high', actual: 'risk=' + p.riskLevel + ' dim=' + p.dimension };
});

// ── 10. Invalid riskLevel value ──
check('Invalid riskLevel value', () => {
  const p = normalizeParsed(JSON.parse(stripMarkdown('{"riskLevel":"critical","dimension":"A","issue":"T","recommendation":"F","confidenceScore":80}')));
  return { pass: p && p.riskLevel === 'critical', actual: 'risk=' + p.riskLevel };
});

// ── 11. confidenceScore as string ──
check('confidenceScore as string', () => {
  const p = normalizeParsed(JSON.parse(stripMarkdown('{"riskLevel":"high","dimension":"A","issue":"T","recommendation":"F","confidenceScore":"85"}')));
  return { pass: typeof p.confidenceScore === 'number', actual: 'type=' + typeof p.confidenceScore + ' val=' + p.confidenceScore };
});

// ── 12. Mock provider ──
check('Mock CTO', () => {
  const r = mockProvider('CTO');
  return { pass: r.riskLevel === 'high' && r.confidenceScore === 78, actual: 'risk=' + r.riskLevel + ' conf=' + r.confidenceScore };
});
check('Mock CFO', () => {
  const r = mockProvider('CFO');
  return { pass: r.riskLevel === 'medium', actual: 'risk=' + r.riskLevel };
});
check('Mock unknown → CTO fallback', () => {
  const r = mockProvider('UNKNOWN');
  return { pass: r.riskLevel === 'high', actual: 'risk=' + r.riskLevel };
});

console.log('\n' + '='.repeat(50));
console.log('  ' + pass + '/' + (pass + fail) + ' passed, ' + fail + '/' + (pass + fail) + ' failed');
console.log('='.repeat(50));
process.exit(fail > 0 ? 1 : 0);
