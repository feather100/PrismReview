# Sprint 7.3 Dev-only Queue LM Studio Pilot Implementation — WorkBuddy Review

> **模式**：标准流程（协议 §5.5 独立 Gate，非快速 Gate）
> **复审对象**：`Sprint_7.3_Dev_Queue_LMStudio_Pilot_Backend.md` + 代码只读核对（`queue.service.ts`、`provider-adapter.js`、`reviews.service.ts`、`.env.example`、前端 `ReportPage.tsx`/`client.ts`、Prisma schema）+ 全量 smoke 实跑取证
> **上游 Gate**：`Sprint_7.2_Workbuddy_Review.md`（Go）
> **复审人**：WorkBuddy（只读 Gate 模式）
> **复审时间**：2026-07-10 08:53

---

## 结论：**Go（无保留）**

7.3 按 7.2 合同落地了唯一真实缺口（`MODEL_PILOT_MAX_ROLES` 硬约束），改动最小且完全 gate 在 pilot env 内；默认 mock demo 端到端回归 100% 通过。11 项重点检查 + 5 项补充核查全部通过，代码行号与磁盘实现逐字吻合，五套 smoke（dev-pilot 23/23、provider-robustness 14/14、queue 15/15、export 21/21、runtime 31/31）+ tsc 0 errors 均由本机实跑取证，非仅凭文档声明。

---

## 证据（用户 11 项重点检查）

| # | 检查 | 结果 | 关键证据 |
|---|------|------|---------|
| 1 | 默认 mock 完全不变 | ✅ | `getProvider():208-210` 未改（`if(!provider\|\|'mock')→mock`）；`applyPilotRoleCap():183` 首行 `if(provider!=='lmstudio'\|\|allow!=='true') return roles` — mock/default 路径零额外行为；smoke-queue/export/runtime 默认 mock 全过 |
| 2 | startReview <1s，不在 HTTP 生命周期调 provider | ✅ | `reviews.service.ts:166-182` 仅 `assertReview`+`prisma.update`+`enqueue('review.start')`→返回 `{sessionId,'running'}`，无 provider 调用；smoke-queue「POST /start returns <1s」✅、smoke-runtime #11 ✅ |
| 3 | provider 仅在 `agent.turn.execute` 执行 | ✅ | 唯一调用点 `executeAgentTurn():261`（`provider.run(roleCode,objective)`）；`executeReviewStart()` 仅 enqueue 子 job；cap 逻辑在派发前，不触发任何模型调用 |
| 4 | 未接 openai_compatible | ✅ | `queue.service.ts` 全文 grep `openai_compatible` 零命中；结构性排除：openai_compatible 需 `MODEL_API_KEY`（adapter `:227`），pilot 不设该 Key → GUARD；smoke-queue「openai_compatible no API key → GUARD」✅ |
| 5 | guard/config/auth → failed + NO_RETRY，不 fallback | ✅ | Guard `:236-253`（getProvider catch→failed turn+failed opinion stub+`throw NO_RETRY`）；Auth `:275-291`（401/403→`Bearer ***` 脱敏+failed+`NO_RETRY`）；两分支均 **不** 进 fallback；smoke-dev-pilot §2/§3 ✅ |
| 6 | runtime/timeout/invalid JSON → fallback_mock + warn | ✅ | `:293-305` 单次 `[Fallback] warn`+`mockProvider(roleCode)`+`providerSource:'fallback_mock'`+`fallback:true`，不重试真实 provider；timeout=AbortError→runtime、invalid JSON=Unparseable→runtime（adapter `:110/:140`）；smoke-dev-pilot §4「dead 端口→fallback_mock 无 NO_RETRY」✅ |
| 7 | modelOutputRef/providerSummary 区分 mock/lmstudio/fallback_mock/failed | ✅ | modelOutputRef.providerSource 四值落库点：success `:265`(result.provider)、guard `:250`('failed')、auth `:288`('failed')、runtime `:298`('fallback_mock')；`buildProviderSummary():412-444` 按 providerSource 聚合 bySource，`hasRealProvider:441` 识别 lmstudio/openai_compatible；smoke-dev-pilot §5「distinct=4/4」✅ |
| 8 | 无 raw response/prompt/API Key 泄漏 | ✅ | `reviewOpinion.create():309-321` 仅结构化字段+reasoningSummary+modelOutputRef，adapter 的 `rawText` 被丢弃；queue 无 `DEBUG_PROVIDER_RAW` 分支；lmstudio 无 Key、401/403 日志 `Bearer ***`；smoke-dev-pilot §6 + smoke-export「Not contain rawText/sk-/prompt/api_key」全 clean |
| 9 | 无 schema/前端改动 | ✅ | Prisma 目录 grep pilot/lmstudio/MODEL_PROVIDER 零命中；前端 2 处命中均为**既有** providerSummary 展示（见补充 #1），无 pilot/queue 逻辑 |
| 10 | smoke-runtime/queue/export/provider-robustness 通过 | ✅ | 本机实跑：runtime **31/31**、queue **15/15**、export **21/21**、provider-robustness **14/14**、dev-pilot **23/23**，均 0 failed |
| 11 | 实跑 LM Studio 调用 ≤3 且脱敏 | ✅（结构保障） | 本环境**未跑真实模型**（仅对 dead 端口连接以证 fallback）；`applyPilotRoleCap()` 已把「单 review ≤3 roles」从配置纪律升级为**代码硬约束**（unset/非法→3，pilot 生效时 `roles.slice(0,max)` 并回写 roleSelection 保持 meeting 计数一致）；脱敏由 #8 保证。真实端到端留待用户本地按 §5.5 执行 |

---

## 补充核查（用户 5 项）

| # | 项 | 结果 | 证据 |
|---|-----|------|------|
| 1 | apps/web 命中仅为既有展示 | ✅ | `ReportPage.tsx:145-150` 为 bySource 分布文本渲染（Mock/LMStudio/OpenAI/Fallback/Failed 计数）；`client.ts:109-114` 为 providerSummary 类型定义。二者均无 lmstudio/pilot/queue 逻辑，属 6.x 既有能力 |
| 2 | dist/ 命中仅编译产物，源码范围受限 | ✅ | `grep -rl` (排除 dist/node_modules) 确认源码级仅 `queue.service.ts` 含 `applyPilotRoleCap/MODEL_PILOT_MAX_ROLES`；`dist/.../queue.service.js` 为其 tsc 产物。源码改动清单 = queue.service.ts + .env.example + smoke-dev-pilot.js（+ docs），与文档 §6 一致 |
| 3 | 默认 mock 路径三 smoke 仍通过 | ✅ | queue 15/15、export 21/21、runtime 31/31（含 db_opinions 端到端、report verdict、SSE、分页），默认 mock 行为无回归 |
| 4 | .env.example 未默认启用真实 provider | ✅ | `MODEL_PROVIDER="mock"`（:21）、`ALLOW_EXTERNAL_MODEL_CALLS=false`（:24）、`MODEL_PILOT_MAX_ROLES` 全程注释（:59）；pilot 段明确标注「生产/CI/demo 不得设置」 |
| 5 | 文档/测试输出无泄漏 | ✅ | 7.3 文档密钥/raw 正则唯一命中为 §3「不写 raw response…扫描全部 clean」的**安全声明文本**本身，非真实值；smoke-dev-pilot.js 无硬编码密钥；smoke-export 运行时断言不含 rawText/sk-/prompt/api_key |

---

## 代码核对细节（可信度支撑）

- **cap 仅 pilot 生效、fail-safe 到 3**：`applyPilotRoleCap():180-196` — provider≠lmstudio 或 allow≠true 直接原样返回；env unset/空/非法（abc/0/-2）统一回退 3；仅正整数取该值。截断时 `:133-136` 回写裁剪后的 `roleSelection.roles`，使 `checkMeetingComplete():348` / `executeMeetingComplete():377` 的 `expectedCount`（读自 DB）与实际派发 turn 数一致，避免 review 卡在 running。mock/default 路径无任何额外 DB 写。
- **失败分类矩阵完整可达**：Guard `:236` catch → `NO_RETRY`；Auth `:275` 判定 401/403 → `NO_RETRY`；Runtime `:293` → 单次 fallback_mock。processNext `:76` 对 `NO_RETRY:` 前缀不重试、其余 ≤3 次重试，语义与 7.2 §5 一致，未改。
- **provider 仅收 objective**：`:261 provider.run(roleCode, objective)`，objective 来自 `review.objective`，非用户文档全文。
- **幂等**：turn 终态 skip（`:207-210`）、meeting 状态 DB 重算 skip（`:370-373`）保持。

---

## 非阻塞说明（不拦 Gate）

- **真实模型端到端未在本环境取证**：合规——7.3 文档明确「除非用户本地显式设 env 否则不调真实模型」，本机仅以 dead 端口连接证明 runtime→fallback，无真实推理。真实 LM Studio ≤3 调用 + 脱敏留痕留待用户按 §5.5 dev-only 执行；代码侧硬约束（cap=3）已就位，届时结构上无法超发。
- **仓库非 git 工作区**：无法用 `git diff` 佐证改动清单，本复审改以 grep 源码范围（排除 dist/node_modules）+ 逐文件读取交叉确认，结论等效。

---

## 结论

Sprint 7.3 忠实落地 7.2 合同的唯一真实缺口，改动最小、完全 pilot-gated、默认 mock demo 零回归；guard/auth 严格 fail-closed（NO_RETRY 不 fallback），runtime/timeout/invalid JSON 单次 fallback_mock 且序列化 clean；四类 providerSource 互斥可辨；无 raw/prompt/Key 泄漏；未接 openai_compatible、未改 schema/前端。五套 smoke 全绿 + tsc 0 errors 实跑取证。**Gate = Go（无保留）**。后续 7.4 Demo/Runbook Refresh（纯文档）可推进；真实 LM Studio 端到端由用户本地 dev-only 验收。
