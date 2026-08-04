#!/usr/bin/env node
/**
 * e2e-verify-sprint-10.1.js — 起 API → 跑 verify-sprint-10.1-security.js → 清理。
 * 用法：node scripts/e2e-verify-sprint-10.1.js
 */
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const API_DIR = path.resolve(__dirname, '..', 'apps', 'api');
const PORT = 4000;

function get(url) {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:' + PORT + url, (res) => {
      res.resume();
      resolve(res.statusCode);
    }).on('error', reject);
  });
}
async function waitForServer(ms = 30000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { const s = await get('/api/reviews?page=1&pageSize=1'); if (s < 500) return true; } catch {}
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
}

async function main() {
  const api = spawn('node', ['dist/main.js'], { cwd: API_DIR, stdio: 'ignore' });
  let up = false;
  try { up = await waitForServer(); } catch { up = false; }
  if (!up) { console.error('❌ API 未就绪'); api.kill(); process.exit(1); }
  console.log('✅ API up — running verify-sprint-10.1-security.js...');

  const verify = spawn('node', [path.resolve(__dirname, 'verify-sprint-10.1-security.js')], { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
  const code = await new Promise((resolve) => verify.on('close', resolve));

  api.kill('SIGTERM');
  setTimeout(() => { try { api.kill('SIGKILL'); } catch {} }, 1500);
  console.log('verify 退出码:', code);
  process.exit(code);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
