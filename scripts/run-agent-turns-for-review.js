#!/usr/bin/env node
/**
 * PrismReview — Agent Turn Runner (Sprint 2.0)
 *
 * Independent runner that executes provider turns for a review
 * and writes results to review_turns / review_opinions.
 *
 * Usage:
 *   node scripts/run-agent-turns-for-review.js <reviewId>
 *   node scripts/run-agent-turns-for-review.js <reviewId> --force
 *
 * Idempotent: if turns already exist and --force not set, skips gracefully.
 * --force: cleans existing turns and re-runs all providers.
 *
 * Provider:
 *   Default: mock (no external deps)
 *   LM Studio: MODEL_PROVIDER=lmstudio ALLOW_EXTERNAL_MODEL_CALLS=true
 */

function resolvePrisma() {
  const paths = [
    './node_modules/@prisma/client',
    '../node_modules/@prisma/client',
    '../apps/api/node_modules/@prisma/client',
    '../../node_modules/@prisma/client',
    'D:\\workspace\\PrismReview\\apps\\api\\node_modules\\@prisma\\client',
  ];
  for (const p of paths) {
    try { return require(p); } catch { /* try next */ }
  }
  throw new Error('Cannot find @prisma/client. Run from project root or apps/api directory.');
}

const { PrismaClient } = resolvePrisma();
const { getProvider } = require('./provider-adapter');

const prisma = new PrismaClient();

async function main() {
  const reviewId = process.argv[2];
  const force = process.argv.includes('--force');

  if (!reviewId) {
    console.error('Usage: node scripts/run-agent-turns-for-review.js <reviewId> [--force]');
    process.exit(1);
  }

  console.log(`\n🧩 Agent Turn Runner — Sprint 2.0`);
  console.log(`   Review ID: ${reviewId}`);
  console.log(`   Force: ${force}`);
  console.log('');

  // 1. Load review
  const review = await prisma.review.findUnique({ where: { id: reviewId } });
  if (!review) {
    console.error(`❌ Review not found: ${reviewId}`);
    process.exit(1);
  }

  // 2. Read role selection
  const selection = review.roleSelection;
  if (!selection || !selection.roles || selection.roles.length === 0) {
    console.error(`❌ No role selection found for review ${reviewId}`);
    process.exit(1);
  }

  // 3. Resolve role details
  const roleIds = selection.roles.map(r => r.roleId);
  const dbRoles = await prisma.agentRole.findMany({
    where: { id: { in: roleIds }, status: 'enabled' },
    select: { id: true, code: true, name: true, activeVersionId: true },
  });

  // Validate activeVersionId for every role
  for (const dbRole of dbRoles) {
    if (!dbRole.activeVersionId) {
      console.error(`❌ Role "${dbRole.code}" (${dbRole.name}) has no activeVersionId. Seed the role first.`);
      process.exit(1);
    }
  }

  const roleMap = new Map(dbRoles.map(r => [r.id, r]));

  const turns = selection.roles.map((r, i) => {
    const dbRole = roleMap.get(r.roleId);
    if (!dbRole) {
      console.error(`❌ Role ${r.roleId} not found or disabled`);
      process.exit(1);
    }
    return {
      roleId: r.roleId,
      roleCode: dbRole.code,
      roleName: dbRole.name,
      weight: r.weight,
      turnIndex: i + 1,
      roleVersionId: dbRole.activeVersionId,
    };
  });

  console.log(`   Total turns to execute: ${turns.length}`);
  turns.forEach(t => console.log(`     ${t.turnIndex}. ${t.roleCode} (${t.roleName})`));
  console.log('');

  // 4. Check existing turns — idempotent logic
  const existingTurns = await prisma.reviewTurn.findMany({
    where: { reviewId },
    orderBy: { turnIndex: 'asc' },
  });
  const existingCompleted = existingTurns.filter(t => t.status === 'completed');

  // 4a. Non-force: review must be running or completed
  if (!force) {
    if (review.status !== 'running' && review.status !== 'completed') {
      console.error(`❌ Review status is "${review.status}". Expected "running" or "completed".`);
      process.exit(1);
    }

    if (existingCompleted.length > 0) {
      console.log(`⚠️  Found ${existingCompleted.length} completed turn(s). Skipping — idempotent guard active.`);
      console.log('   Use --force to re-run.');
      await printResults(reviewId);
      await prisma.$disconnect();
      process.exit(0);
    }

    // No existing completed turns — proceed with execution
  }

  // 4b. --force: accept running/completed/failed, clean and re-run
  if (force) {
    if (!['running', 'completed', 'failed'].includes(review.status)) {
      console.error(`❌ --force requires status running/completed/failed, got "${review.status}"`);
      process.exit(1);
    }

    if (existingTurns.length > 0) {
      console.log(`🧹 --force: cleaning ${existingTurns.length} existing turn(s) and their opinions...`);
      await prisma.reviewOpinion.deleteMany({ where: { reviewId } });
      await prisma.reviewTurn.deleteMany({ where: { reviewId } });
      console.log('   Cleaned.\n');
    }

    // Reset review to running before execution
    await prisma.review.update({ where: { id: reviewId }, data: { status: 'running' } });
  }

  // 5. Get provider
  const provider = getProvider();
  console.log(`   Provider: ${provider.name}\n`);

  // 6. Execute turns
  let successCount = 0;
  let failCount = 0;
  const startTime = Date.now();

  for (const turn of turns) {
    process.stdout.write(`   Turn ${turn.turnIndex}/${turns.length}: ${turn.roleCode}... `);

    const reviewTurn = await prisma.reviewTurn.create({
      data: {
        reviewId,
        turnIndex: turn.turnIndex,
        phase: 'round_robin',
        roleVersionId: turn.roleVersionId,
        status: 'retrieving',
        startedAt: new Date(),
      },
    });

    try {
      await prisma.reviewTurn.update({ where: { id: reviewTurn.id }, data: { status: 'thinking' } });
      const result = await provider.run(turn.roleCode, review.objective);

      await prisma.reviewOpinion.create({
        data: {
          reviewId,
          turnId: reviewTurn.id,
          dimension: result.dimension,
          riskLevel: result.riskLevel,
          issue: result.issue,
          recommendation: result.recommendation,
          citations: [],
          confidenceScore: result.confidenceScore,
          reasoningSummary: result.rawText ? result.rawText.substring(0, 200) : null,
          modelOutputRef: result.rawText,
        },
      });

      await prisma.reviewTurn.update({
        where: { id: reviewTurn.id },
        data: { status: 'completed', completedAt: new Date() },
      });

      console.log(`✅ ${result.riskLevel} risk, ${result.confidenceScore} confidence`);
      successCount++;
    } catch (err) {
      await prisma.reviewTurn.update({
        where: { id: reviewTurn.id },
        data: { status: 'failed', completedAt: new Date() },
      });
      console.log(`❌ ${err.message.substring(0, 80)}`);
      failCount++;
    }
  }

  // 7. Update review status
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  if (successCount > 0) {
    await prisma.review.update({ where: { id: reviewId }, data: { status: 'completed' } });
    console.log(`\n✅ ${successCount}/${turns.length} turns completed, ${failCount} failed (${elapsed}s)`);
  } else {
    await prisma.review.update({ where: { id: reviewId }, data: { status: 'failed' } });
    console.log(`\n❌ All ${turns.length} turns failed (${elapsed}s)`);
  }

  await printResults(reviewId);
  await prisma.$disconnect();
}

async function printResults(reviewId) {
  const turns = await prisma.reviewTurn.findMany({
    where: { reviewId },
    include: { opinions: true },
    orderBy: { turnIndex: 'asc' },
  });

  console.log(`\n📊 Results for review ${reviewId.substring(0, 8)}...`);
  for (const t of turns) {
    const o = t.opinions[0];
    if (o) {
      console.log(`   ${t.turnIndex}. ${t.status} — ${o.dimension} — ${o.riskLevel} (confidence: ${o.confidenceScore})`);
    } else {
      console.log(`   ${t.turnIndex}. ${t.status} (no opinion)`);
    }
  }
  console.log('');
}

main().catch((err) => {
  console.error(`\n❌ Runner failed: ${err.message}`);
  prisma.$disconnect().catch(() => {});
  process.exit(1);
});
