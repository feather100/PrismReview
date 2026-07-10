/**
 * PrismReview — Local LLM Spike (Sprint 1.7)
 *
 * Isolated script to verify LM Studio OpenAI-compatible API is reachable.
 * NOT connected to the main review/meeting/report pipeline.
 *
 * Guard: only runs when MODEL_PROVIDER=lmstudio AND ALLOW_EXTERNAL_MODEL_CALLS=true
 *
 * Usage:
 *   node scripts/spike-local-llm.js                          # guard blocks
 *   MODEL_PROVIDER=lmstudio ALLOW_EXTERNAL_MODEL_CALLS=true \
 *     node scripts/spike-local-llm.js                         # calls LM Studio
 */

const LMSTUDIO_BASE = process.env.LMSTUDIO_BASE_URL || 'http://10.0.45.168:1234/v1';
const LMSTUDIO_MODEL = process.env.LMSTUDIO_MODEL || 'google/gemma-4-12b';

function guard() {
  const provider = process.env.MODEL_PROVIDER || '';
  const allow = process.env.ALLOW_EXTERNAL_MODEL_CALLS || '';
  if (provider !== 'lmstudio' || allow !== 'true') {
    console.log('🔒 MODEL PROVIDER GUARD');
    console.log('');
    console.log(`  MODEL_PROVIDER=${provider || '(not set)'}`);
    console.log(`  ALLOW_EXTERNAL_MODEL_CALLS=${allow || '(not set)'}`);
    console.log('');
    console.log('  Set both to enable LM Studio call:');
    console.log('    export MODEL_PROVIDER=lmstudio');
    console.log('    export ALLOW_EXTERNAL_MODEL_CALLS=true');
    console.log('');
    console.log('  This guard prevents accidental external model calls.');
    console.log('  LM Studio is a LOCAL provider — do NOT use with real production documents.');
    process.exit(0);
  }
}

guard();

const TIMEOUT_MS = 120000;

const SYSTEM_PROMPT = `You are a technical reviewer (CTO). Review the provided proposal and output a structured JSON assessment.
Always respond with valid JSON only, no markdown, no explanation outside the JSON.

JSON schema:
{
  "riskLevel": "high" | "medium" | "low" | "info",
  "dimension": "string",
  "issue": "string (specific problem description)",
  "recommendation": "string (actionable improvement suggestion)",
  "confidenceScore": "number (0-100)"
}`;

const USER_PROMPT = `Proposal: Migrate the monolith to microservices with Kafka event bus.

Key points:
- Split into 6 services: API Gateway, User, Order, Payment, Notification, Analytics
- Use Kafka for inter-service communication
- Saga pattern for distributed transactions
- CQRS for read-heavy services
- Kubernetes deployment, 3-node cluster minimum`;

async function main() {
  console.log(`\n🔬 Local LLM Spike — LM Studio`);
  console.log(`   Base: ${LMSTUDIO_BASE}`);
  console.log(`   Model: ${LMSTUDIO_MODEL}`);
  console.log(`   Timeout: ${TIMEOUT_MS}ms\n`);

  const start = Date.now();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(`${LMSTUDIO_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: LMSTUDIO_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: USER_PROMPT },
        ],
        temperature: 0.1,
        max_tokens: 2048,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    const elapsed = Date.now() - start;
    console.log(`⏱  Response received in ${elapsed}ms\n`);

    if (!response.ok) {
      console.log(`❌ HTTP ${response.status} ${response.statusText}`);
      const text = await response.text();
      console.log(`   Body: ${text.substring(0, 500)}`);
      process.exit(1);
    }

    const body = await response.json();
    const rawContent = body?.choices?.[0]?.message?.content || '(no content)';

    // Print safe diagnostics only. Full raw requires DEBUG_PROVIDER_RAW=true
    if (process.env.DEBUG_PROVIDER_RAW === 'true') {
      console.log('=== Raw Response (DEBUG) ===');
      console.log(rawContent);
      console.log('=============================\n');
    }

    // Attempt JSON parse
    let parsed = null;
    try {
      // Try direct parse
      parsed = JSON.parse(rawContent);
    } catch {
      // Try to extract JSON from markdown code block
      const match = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) {
        try { parsed = JSON.parse(match[1]); } catch { /* ignore */ }
      }
    }

    if (parsed) {
      if (process.env.DEBUG_PROVIDER_RAW === 'true') {
        console.log('=== Parsed JSON (DEBUG) ===');
        console.log(JSON.stringify(parsed, null, 2));
        console.log('============================\n');
      }

      // Validate schema
      const required = ['riskLevel', 'dimension', 'issue', 'recommendation', 'confidenceScore'];
      const missing = required.filter(k => parsed[k] === undefined);
      if (missing.length > 0) {
        console.log(`❌ Missing fields: ${missing.join(', ')}`);
        process.exit(1);
      } else {
        console.log('✅ All required fields present');
      }
    } else {
      console.log('❌ Could not parse response as JSON — parse_error');
      process.exit(1);
    }

    // Usage info
    if (body?.usage) {
      console.log(`\nTokens: ${JSON.stringify(body.usage)}`);
    }

  } catch (err) {
    const elapsed = Date.now() - start;
    if (err.name === 'AbortError') {
      console.log(`❌ Request timed out after ${TIMEOUT_MS}ms`);
    } else {
      console.log(`❌ Request failed after ${elapsed}ms: ${err.message}`);
    }
    process.exit(1);
  }
}

main();
