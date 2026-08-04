#!/usr/bin/env node
/**
 * e2e-smoke.js — API 启动冒烟 + 关键端点检查（T1–T11 全栈验证）。
 *
 * 用法：node scripts/e2e-smoke.js
 * 行为：spawn dist/main.js → 等待端口 4000 → 检查关键端点 → 清理子进程。
 * 环境：apps/api/.env（DATABASE_URL 指向本地 Postgres，docker compose）。
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const API_DIR = path.resolve(__dirname, '..', 'apps', 'api');
const PORT = 4000;
const BASE = `http://localhost:${PORT}`;

function get(url) {
  return new Promise((resolve, reject) => {
    http
      .get(BASE + url, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      })
      .on('error', reject);
  });
}

async function waitForServer(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await get('/api/reviews?page=1&pageSize=1');
      if (r.status < 500) return true;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
}

async function main() {
  console.log('[e2e-smoke] starting API...');
  const child = spawn('node', ['dist/main.js'], {
    cwd: API_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });
  child.stdout.on('data', (d) => { if (process.env.SMOKE_VERBOSE) process.stdout.write(d); });
  child.stderr.on('data', (d) => { if (process.env.SMOKE_VERBOSE) process.stderr.write(d); });

  let up = false;
  try {
    up = await waitForServer();
  } catch { up = false; }

  if (!up) {
    console.error('[e2e-smoke] ❌ API 未在 ' + PORT + ' 就绪');
    child.kill('SIGTERM');
    process.exit(1);
  }
  console.log('[e2e-smoke] ✅ API up');

  const checks = [
    ['GET /api/reviews', '/api/reviews?page=1&pageSize=1', (r) => r.status === 200],
    ['GET /api/audit/logs', '/api/audit/logs?page=1&pageSize=1', (r) => r.status === 200],
    ['GET /api/llm-providers', '/api/llm-providers', (r) => r.status < 500],
    ['GET /api/roles', '/api/roles', (r) => r.status < 500],
    ['GET /api/knowledge/documents', '/api/knowledge/documents', (r) => r.status < 500],
  ];

  let pass = 0;
  for (const [label, url, ok] of checks) {
    try {
      const r = await get(url);
      const good = ok(r);
      console.log(`  [${good ? '✅' : '❌'}] ${label} → HTTP ${r.status}`);
      if (good) pass++;
    } catch (e) {
      console.log(`  [❌] ${label} → ${e.message}`);
    }
  }

  child.kill('SIGTERM');
  // 确保子进程退出
  setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 1500);

  const total = checks.length;
  console.log(`[e2e-smoke] ${pass}/${total} checks passed`);
  process.exit(pass === total ? 0 : 1);
}

main().catch((e) => {
  console.error('[e2e-smoke] error:', e.message);
  process.exit(1);
});
