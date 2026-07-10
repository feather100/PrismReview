/**
 * PrismReview — Agent Turn Spike (Sprint 1.8)
 *
 * Demonstrates the provider adapter with mock (default) or LM Studio.
 * Input: roleCode + proposal text. Output: AgentTurnResult.
 *
 * Usage:
 *   node scripts/spike-agent-turn.js                            # mock
 *   node scripts/spike-agent-turn.js --role CFO                 # mock, CFO role
 *   node scripts/spike-agent-turn.js --proposal "..."           # custom proposal
 *
 *   # LM Studio (requires env)
 *   MODEL_PROVIDER=lmstudio ALLOW_EXTERNAL_MODEL_CALLS=true \
 *     node scripts/spike-agent-turn.js
 *
 *   # All options
 *   node scripts/spike-agent-turn.js --role Compliance --proposal "..."
 */

const { getProvider } = require('./provider-adapter');

const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
};

const DEFAULT_PROPOSAL =
  'Migrate the monolith to microservices with Kafka event bus. '
  + 'Split into 6 services: API Gateway, User, Order, Payment, Notification, Analytics. '
  + 'Use Saga pattern for distributed transactions, CQRS for read-heavy services. '
  + 'Deploy on Kubernetes with 3 nodes.';

async function main() {
  const roleCode = getArg('--role') || 'CTO';
  const proposal = getArg('--proposal') || DEFAULT_PROPOSAL;

  console.log(`\n🧩 Agent Turn Spike — Provider Adapter`);
  console.log(`   Role:     ${roleCode}`);
  console.log(`   Proposal: ${proposal.substring(0, 60)}...\n`);

  const start = Date.now();

  try {
    const provider = getProvider();
    console.log(`   Provider: ${provider.name}\n`);
    const result = await provider.run(roleCode, proposal);
    const elapsed = Date.now() - start;

    console.log(`⏱  ${elapsed}ms\n`);
    if (process.env.DEBUG_PROVIDER_RAW === 'true') {
      console.log('=== AgentTurnResult (DEBUG) ===');
      console.log(JSON.stringify(result, null, 2));
      console.log('================================\n');
    }

    // Validate schema
    const required = ['roleCode', 'dimension', 'riskLevel', 'issue', 'recommendation', 'confidenceScore'];
    const missing = required.filter(k => result[k] === undefined);
    if (missing.length > 0) {
      console.log('❌ Missing fields: ' + missing.join(', '));
      process.exit(1);
    } else {
      console.log('✅ All required fields present');
    }
  } catch (err) {
    const elapsed = Date.now() - start;
    console.log('❌ Failed after ' + elapsed + 'ms: ' + err.message);
    process.exit(1);
  }
}

main();
