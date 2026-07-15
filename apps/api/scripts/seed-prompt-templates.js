/**
 * seed-prompt-templates.js — Sprint 5.1 P3 首次数据迁移（gitignored 工具脚本）
 *
 * 把现有 AgentRoleVersion.systemPrompt 同步为 PromptTemplateRecord 的 base/task/format v1.0，
 * 使 PromptService.compose() 对每个 preset/custom 角色都有可用模板（Implementation §2.4 / Contract §2.5）。
 * 幂等：已存在 (roleCode, layer, version) 则跳过。
 *
 * 用法：node apps/api/scripts/seed-prompt-templates.js
 */
'use strict';

require('reflect-metadata');
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const txt = fs.readFileSync(envPath, 'utf8');
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*"?([^"\n]*?)"?\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

async function main() {
  const { PrismaService } = require('../dist/prisma/prisma.service.js');
  const { seedPresetPromptTemplates } = require('../dist/modules/prompt/prompt.service.js');
  const prisma = new PrismaService();
  const { created } = await seedPresetPromptTemplates(prisma);
  console.log(`seed-prompt-templates: synced ${created} PromptTemplateRecord row(s) (base/task/format v1.0).`);
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error('FATAL', e);
  process.exit(2);
});
