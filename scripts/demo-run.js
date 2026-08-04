#!/usr/bin/env node
/**
 * demo-run.js — 完整演示：起 API + Web，走通「创建评审 → 诊断 → 选角色 → 多轮评审(真 LLM) → 报告」。
 *
 * 用法：
 *   node scripts/demo-run.js          启动服务 + 跑全流程（服务保留运行，供浏览器查看）
 *   node scripts/demo-run.js --cleanup  按 .demo-pids.json 清理服务进程
 *
 * 说明：默认使用 DB 中激活的 LLM provider（LongCat-2.0，付费接口）；
 *       服务以 detached 方式启动（父进程退出后仍存活）。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const API_DIR = path.join(ROOT, 'apps', 'api');
const WEB_DIR = path.join(ROOT, 'apps', 'web');
const PID_FILE = path.join(ROOT, '.demo-pids.json');
const API_LOG = path.join(ROOT, '.demo-api.log');
const API = 'http://localhost:4000/api';
const WEB = 'http://localhost:3000';

function req(method, url, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const u = new URL((method === 'web' ? WEB : API) + url);
    const options = { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: { 'Content-Type': 'application/json' } };
    const r = http.request(options, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { try { resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }); } catch { resolve({ status: res.statusCode, body: b }); } }); });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
async function waitHttp(method, url, timeoutMs = 90000) {
  const start = Date.now();
  for (;;) {
    try { const r = await req(method, url); if (r.status < 500) return r; } catch {}
    if (Date.now() - start > timeoutMs) throw new Error('timeout waiting ' + url);
    await new Promise((r) => setTimeout(r, 800));
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cleanup() {
  try {
    const pids = JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
    for (const pid of pids) { try { process.kill(pid, 'SIGTERM'); } catch {} }
    fs.unlinkSync(PID_FILE);
    console.log('[demo] 已清理服务进程', pids.join(','));
  } catch {}
}

async function main() {
  if (process.argv.includes('--cleanup')) { cleanup(); return; }
  cleanup();

  // ── 启动服务（detached 保证父进程退出后存活；API 日志留档）──
  const apiLog = fs.openSync(API_LOG, 'a');
  const api = spawn('node', ['dist/main.js'], {
    cwd: API_DIR, stdio: ['ignore', apiLog, apiLog], detached: true,
    env: { ...process.env, ALLOW_EXTERNAL_MODEL_CALLS: 'true' },
  });
  const web = spawn('npx.cmd', ['next', 'dev', '-p', '3000'], { cwd: WEB_DIR, stdio: 'ignore', detached: true, shell: true });
  api.unref(); web.unref();
  fs.writeFileSync(PID_FILE, JSON.stringify([api.pid, web.pid]));

  console.log('[demo] 启动 API(:4000) + Web(:3000) ...');
  await waitHttp('GET', '/api/reviews?page=1&pageSize=1');
  console.log('[demo] ✅ API up');
  await waitHttp('GET', '/', 120000).catch(() => {});
  console.log('[demo] ✅ Web up: ' + WEB);

  // ── 取激活 provider（LongCat 付费接口）──
  const provResp = await req('GET', '/llm-providers');
  const provList = Array.isArray(provResp.body) ? provResp.body : provResp.body?.items ?? [];
  const active = provList.find((p) => p.isActive === true || p.status === 'ready') || provList[0];
  const providerId = active?.id;
  console.log('[demo] ① 使用 LLM provider:', active ? active.name + ' (' + active.provider + ')' : '未找到激活 provider');

  // ── 创建评审（content 含真实方案文本）──
  const content = [
    '第一部分：项目背景。本方案面向企业核心业务系统升级，目标是提升系统可用性与投入产出效率。',
    '',
    '第二部分：技术架构。方案采用微服务架构拆分关键模块，需设置超时和熔断机制，避免单点故障风险；数据层引入缓存与分库分表。',
    '',
    '第三部分：安全与合规。需要满足等保合规要求，数据加密传输与存储，密钥统一托管。',
    '',
    '第四部分：预算与周期。初期投入较高，长期ROI可期但需分阶段验证；首阶段聚焦核心功能验证，计划分三期交付。',
  ].join('\n');
  const created = await req('POST', '/reviews', {
    title: 'Demo：核心业务系统升级方案评审（真 LLM）',
    objective: '对核心业务系统升级方案进行多维度评审，评估架构合理性、投入产出、交付风险、安全合规与用户体验',
    content,
    mode: process.env.DEMO_MODE || 'enterprise', // research 可展示多轮+扩容（更慢）
    llmProviderId: providerId,
  });
  const reviewId = created.body?.id;
  console.log('[demo] ② 创建评审 →', reviewId, '| status', created.body?.status);

  // ── 诊断 + 选角色 ──
  await req('POST', '/reviews/' + reviewId + '/diagnose');
  console.log('[demo] ③ 诊断完成');
  const rolesResp = await req('GET', '/roles');
  const allRoles = Array.isArray(rolesResp.body) ? rolesResp.body : rolesResp.body?.items ?? [];
  const picked = ['CTO', 'CFO', 'PMO', 'Compliance']
    .map((c) => allRoles.find((r) => r.code === c))
    .filter(Boolean)
    .map((r) => ({ roleId: r.id, weight: 25 }));
  await req('POST', '/reviews/' + reviewId + '/roles', { roles: picked });
  console.log('[demo] ④ 已选角色:', picked.map((r) => r.roleId).length, '个（CTO/CFO/PMO/Compliance）');

  // ── 启动评审（真 LLM 多轮）──
  await req('POST', '/reviews/' + reviewId + '/start');
  console.log('[demo] ⑤ 评审启动（research 至少 2 轮，真 LLM 调用中...）');

  let status = 'running';
  let resumed = false;
  for (let i = 0; i < 240; i++) {
    await sleep(3000);
    const r = await req('GET', '/reviews/' + reviewId);
    status = r.body?.status;
    if (status === 'interrupted' && !resumed) {
      console.log('[demo]    ⚠ 中断（风险门/升级触发）→ resume');
      await req('POST', '/reviews/' + reviewId + '/resume');
      resumed = true;
      continue;
    }
    if (['completed', 'aborted', 'failed'].includes(status)) break;
    if (i % 10 === 0) console.log('[demo]    状态:', status, '（等待中...）');
  }
  console.log('[demo] ⑥ 终态:', status);

  // ── 报告 ──
  const rep = (await req('GET', '/reviews/' + reviewId + '/report')).body;
  console.log('\n══════════ Demo 报告 ══════════');
  console.log('标题:', rep.title);
  console.log('结论:', rep.verdict, '| 综合评分:', rep.scoring?.overallScore, '| 意见数:', rep.opinionCount);
  console.log('评分分布:', JSON.stringify(rep.scoring?.distribution), '| 通胀预警:', rep.scoring?.inflationWarning);
  if (rep.scoring?.dimensionScores) console.log('维度评分:', rep.scoring.dimensionScores.map((d) => d.dimension + '=' + d.weightedScore).join(', '));
  const withPassage = (rep.opinions || []).filter((o) => o.passageRefs?.length > 0);
  console.log('带段落锚点意见数:', withPassage.length, '/', (rep.opinions || []).length);
  const s = rep.opinions?.[0];
  if (s) console.log('示例意见:', s.dimension, '|', s.riskLevel, '| score=' + s.score, '| passageRefs=' + JSON.stringify(s.passageRefs));
  console.log('\n报告页: ' + WEB + '/reviews/' + reviewId + '/report');
  console.log('评审页: ' + WEB + '/reviews/' + reviewId);
  console.log('服务保持运行（清理: node scripts/demo-run.js --cleanup）');
}

main().catch((e) => { console.error('[demo] 失败:', e.message); process.exit(1); });
