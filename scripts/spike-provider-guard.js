#!/usr/bin/env node
/**
 * PrismReview — Provider Guard Spike (Sprint 4.4B)
 *
 * Verifies mock / lmstudio / openai_compatible provider guard rules.
 *
 * Usage:
 *   node scripts/spike-provider-guard.js --provider mock
 *   MODEL_PROVIDER=lmstudio ALLOW_EXTERNAL_MODEL_CALLS=true ... node scripts/spike-provider-guard.js
 *   MODEL_PROVIDER=openai_compatible ALLOW_EXTERNAL_MODEL_CALLS=true MODEL_API_KEY=sk-... MODEL_BASE_URL=... node scripts/spike-provider-guard.js
 */

const { getProvider } = require('./provider-adapter');

const args = process.argv.slice(2);
const getArg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };

const DEFAULT_PROPOSAL = 'Migrate the monolith to microservices with Kafka event bus. ' +
  'Split into 6 services: API Gateway, User, Order, Payment, Notification, Analytics. ' +
  'Use Saga pattern for distributed transactions, CQRS for read-heavy services.';

async function main() {
  const roleCode = getArg('--role') || 'CTO';
  const proposal = getArg('--proposal') || DEFAULT_PROPOSAL;

  console.log(`\n🔬 Provider Guard Spike — Sprint 4.4B\n`);
  console.log(`   MODEL_PROVIDER: ${process.env.MODEL_PROVIDER || '(mock)'}`);
  console.log(`   ALLOW_EXTERNAL_MODEL_CALLS: ${process.env.ALLOW_EXTERNAL_MODEL_CALLS || '(unset)'}${process.env.ALLOW_EXTERNAL_MODEL_CALLS === 'true' ? ' ✅' : ''}`);
  console.log(`   MODEL_BASE_URL: ${process.env.MODEL_BASE_URL || process.env.LMSTUDIO_BASE_URL || '(unset)'}`);
  console.log(`   MODEL_NAME: ${process.env.MODEL_NAME || process.env.LMSTUDIO_MODEL || '(unset)'}`);
  console.log(`   MODEL_API_KEY: ${process.env.MODEL_API_KEY ? '***' + process.env.MODEL_API_KEY.slice(-4) : '(unset)'}`);
  console.log(`   Role: ${roleCode}\n`);

  const start = Date.now();

  try {
    const provider = getProvider();
    console.log(`   Provider: ${provider.name}\n`);

    const result = await provider.run(roleCode, proposal);
    const elapsed = Date.now() - start;

    console.log(`⏱  ${elapsed}ms`);
    console.log(`   Provider:  ${result.provider || provider.name}`);
    console.log(`   Model:     ${result.model || 'N/A'}`);
    console.log(`   Status:    success`);
    console.log(`   RiskLevel: ${result.riskLevel}`);
    console.log(`   Dimension: ${result.dimension}`);
    console.log(`   Confidence: ${result.confidenceScore}`);
    console.log(`   Issue:     ${result.issue.substring(0, 80)}${result.issue.length > 80 ? '...' : ''}`);

    // Print safe diagnostics only. Full raw response requires DEBUG_PROVIDER_RAW=true
    if (process.env.DEBUG_PROVIDER_RAW === 'true') {
      console.log('\n=== Full Result (DEBUG) ===');
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (err) {
    const elapsed = Date.now() - start;
    console.log(`⏱  ${elapsed}ms`);
    console.log(`   Status:    FAILED`);
    console.log(`   Error:     ${err.message}`);

    if (err.message.includes('GUARD') || err.message.includes('Unsupported') || err.message.includes('CIRCUIT')) {
      console.log('\n✅ Guard works as expected.');
    } else if (err.message.includes('Unparseable') || err.message.includes('Missing') || err.message.includes('parse')) {
      // JSON parse / schema errors — fail non-zero
      console.log('\n❌ Parse/schema error — see above for details.');
      process.exit(1);
    } else if (err.message.includes('TIMEOUT') || err.message.includes('aborted')) {
      console.log('\n❌ Timeout — provider did not respond in time.');
      process.exit(1);
    } else {
      // Other unexpected errors
      console.log('\n❌ Unexpected error — should not happen.');
      process.exit(1);
    }
  }
}

main();
