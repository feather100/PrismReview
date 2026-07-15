# Codebase Audit Report — PrismReview

> Generated: 2026-07-15
> Scope: full repo sweep in support of the **Phase 5 · GitHub 门面打磨 + P6 预备** push.
> Method: static code review across `apps/api`, `apps/web`, `apps/worker`, infra/config, docs; secret scan; TypeScript baseline; review of key orchestration/rbac/provider subsystems.

This audit is structured as: **verdict → findings (P0 / P1 / P2) → phase-2 fix plan**.

---

## 0. Baseline snapshot

| Area | Finding |
|------|---------|
| TypeScript (`api` + `web`) | **both pass `tsc --noEmit` with 0 errors** (baseline clean) |
| Prisma schema | 22 models, 6 migrations, valid |
| Test infra | **no `jest`/`vitest` config, no `*.test.ts`**. Only `scripts/*.js` smoke/verify (16 scripts, ~2,435 LOC). `test` script in root `package.json` runs `turbo test` which has no backing config. |
| Secrets (manual scan) | **clean** — no live `sk-*` / `AIza` / `Bearer <long-token>` / `SECRET=literal` strings anywhere in tracked source. `.env.example` uses placeholders only. |
| Docker compose | 3 services (pg/redis/minio), all have healthchecks + named volumes. Missing `restart` policies. pg uses `16-alpine` (no pgvector, documented deviation). |
| `.gitignore` | **adequate** — ignores `.env`, `data/`, `.reasonix/`, `.workbuddy/`, `node_modules`, `dist`, `*.log`, migrations dir, etc. |
| `.github/` | **MISSING entirely** (no issue templates, PR template, CI workflow) |
| `LICENSE` | **MISSING** (README self-reports this gap; badge on line 7 is a dead link) |

---

## 1. Architecture & orchestration verdict

**Overall: S-A-F-E — the orchestrator spine is the project's strongest asset and is coherent.**

The 9-state machine is correctly defined, terminal states are a closed set, `isTerminalStatus` is the single source of truth, and `cleanupReview()` is on the critical path for every terminal/failed transition plus `onModuleDestroy`. route() is pure. The HITL `interrupted → running` loop is structurally well-defined. No dead code in the orchestrator files themselves.

### Findings

#### P2 — QueueService is an in-memory array, not BullMQ
- **Location:** `apps/api/src/modules/reviews/queue/queue.service.ts` (lines 26–28: `private queue: QueueJob[] = []`)
- **Detail:** `apps/api/package.json` declares `@nestjs/bullmq` + `bullmq` as dependencies. `BullModule` is **never imported** anywhere in `apps/api/src`. The runtime queue is a hand-rolled in-memory array with polling intervals. The BullMQ deps are dead weight.
- **Impact:** zero functional impact on the current "modular monolith, single-process" MVP, but a mismatch between declared deps and reality and a (minor) ongoing cost if someone tries to wire BullMQ later and finds stale config.
- **Fix (P6 candidate):** either wire BullMQ for horizontal scalability (true P6 work), or remove the dead deps from `apps/api/package.json` to be honest. **Recommendation: leave as-is for this push (single-process MVP is deliberate), but record it on the P6 roadmap as the first Queue milestone.**

#### P2 — `NO_RETRY` path is fail-closed by env-gate, but error classification could drift with new providers
- The distinction `retryable vs non-retryable` lives in `LmStudioAdapterError.kind`. When `queue.service.ts` decides whether to retry, it reads `retryable`. Good pattern; just noting that every new adapter must correctly map to that contract. Not a bug, just a maintenance note.

#### P2 — `currentRound` state is driven by orchestrator, no external mutation guard
- The state mutation is single-threaded (Node.js event loop + one review = one turn at a time per queue), so race conditions on `state.round` are not currently reachable. If multi-process BullMQ lands in P6, this will need transactional round bumping.

#### Risk/P2 — SSRF surface through MODEL_BASE_URL
- `createProviderAdapter()` accepts `MODEL_BASE_URL` (any URL). If a future control-plane ever lets tenants set their own base URL, this becomes an SSRF vector. Currently env-gated only by ops, so **acceptable for MVP**. Note for P6.

---

## 2. Security & RBAC verdict

**Overall: S-A-F-E — this is the project's best-hardened layer after the orchestrator.**

`app.module.ts` registers `JwtAuthGuard` then `PermissionsGuard` as two `APP_GUARD`s in the right order. The `JwtAuthGuard` mock-user injection correctly back-fills `user.permissions` from `platformRole`, closing the historical gap noted in `ACTIVE_SPRINT`. OR-semantics on `PermissionsGuard` is intentional. The `AuditInterceptor` has a complete resource/verb/action mapping, skips reads and `/audit` to prevent recursion, and swallows audit errors so they never block the main flow. Passwords/tokens are explicitly scrubbed from audit details.

**No P0/P1.** Findings:

#### P2 — `@RequirePermissions` annotation coverage is partial
- `ReviewsController`: only `POST /reviews` is annotated (`review.create`). `GET /reviews`, `GET /reviews/:id`, `diagnose`, `roles`, `start`, `human-turn`, `meeting/stream`, `report`, `report/export.md`, `archive`, `unarchive` **all have no `@RequirePermissions`**. Since Orchestrator config disallows un-guarded access, the data still can't escape tenant scope — but the RBAC audit surface is thinner than the RBAC model (4 roles, 13 claims) suggests.
- **Recommendation:** annotate all controller methods with their matrix entry in a future pass (P6 hardening). Current MVP demo reliance (no auth service wiring) keeps this a P2.

#### P2 — Mock `JwtAuthGuard` returns a **real user-shaped object** that all permissions rely on — documented-but-not-honest posture on the README
- The README says "RBAC + 审计"; the actual guard is a "mock that injects a user with enterprise_admin permissions". This is fine for MVP and intentionally default-mock, but the README should be clearer that auth is a dev-local mock for now so adopters don't misjudge the security posture.

#### P2 — CORS origin is `WEB_ORIGIN || http://localhost:3000` with no allow-list
- Fine for dev. If this ever gets a real default-env deployment (e.g. Vercel preview), the fallback origin needs to become an explicit list in P6.

#### Risk/P2 — Tenant isolation relies on `user.tenantId` populated by the guard
- Because the mock guard always sets a fixed `tenantId`, real multi-tenant data separation is not validated end-to-end. Document, defer.

**No P0 or P1.** No credential leak, no bypass path, no intercepted secret.

---

## 3. Frontend verdict

**Overall: S-A-F-E, lean, functional.**

Routes map cleanly to the domain. `AppLayout` correctly gates on status and renders the sidebar based on `pathname`. The Review List page supports status buckets, search w/ debounce, pagination, archive/unarchive. The `useMeetingSSE` hook handles the full SSE event envelope contract. The `api-client/client.ts` correctly sets the bearer header, uses `isAxiosError`, handles 404/400 codes and blob-download w/ content-disposition.

**No P0/P1.** Findings:

#### P2 — Some status strings in `statusMap` keys ( `draft`, `diagnosing`, `ready`, `summarizing` ) belong to the old (pre-9.3) enum and are **orphans** in the Next.js app
- **Location:** `apps/web/src/app/reviews/page.tsx` lines ~20–23
- These old status strings no longer exist in the database (`REVIEW_STATUS_FLOW` and `ReviewStatus` type only have `created|diagnosed|running|summarized|completed|failed|aborted|interrupted|archived`). The orphan map entries are harmless dead branches, but they mislead anyone reading the client into thinking the server still emits those statuses.
- **Fix:** drop the orphan keys from `statusMap`.

#### P2 — "DB Opinions demo" route on `/` (homepage) still instructs users to paste a reviewId with no guard for the soft-fail path where the review is mid-flight.
- Cosmetic only — there's a meeting-status gate elsewhere. Document, defer.

#### P2 — ContextPanel shows a **hardcoded placeholder summary** ("使用 Go 微服务重构订单系统…")
- **Location:** `MeetingPage.tsx` — `<ContextPanel summary="..." />`
- Should be wired to the real review objective/content.

---

## 4. Worker verdict

**Overall: S-T-A-L-E — apps/worker is an un-wired scaffold, not active code.**

The code is **structurally sound** (`llm_guard.py` env-gate is correct; test_llm_guard.py covers the right cases), but:

1. **Celery is not started anywhere**: not in `docker-compose.yml`, not launched by `apps/api`, not in any script. `pnpm dev` starts only web + api.
2. **No NestJS (`BullModule` or other) wiring to the worker** — the worker runs on a totally different runtime (Python/Celery), but there is no broker configuration on the Nest side either (the `bullmq` dep is never imported — see §1).
3. **The real orchestration is fully in `apps/api`** (`queue.service.ts` executes turns in-process). The worker's jobs (parse/run_agent_turn/summarize/diagnose/export/embed) are **all `TODO: Sprint 0.5 — implement …` stubs** — they do nothing.
4. **Explicit staleness:** every job is a stub with a "TODO Sprint 0.5" note, which predates P5. There is no wiring path for jobs ever to be invoked.

**Verdict:** Not P1 legacy noise / not P0 hazard (no dead references from `apps/api`). It is **candidate to be quarantined** under `apps/worker/README.md` with a one-sentence explanation ("Celery scaffold wired up for P6 AgentRuntime worker-process extraction; processed turned handled in-process in NestJS until then"), or shipped to a `contrib/` directory. **Recommendation: for this push, keep the directory but make its dormant status explicit in the README.** Deleting it risks breaking a future P6 branch that already has this scaffold pencilled in.

---

## 5. Documentation & config verdict

**Overall: M-I-X-E-D — the infra/config is solid; the GitHub-facing layer is incomplete.**

### Hard gaps (these are the P1s for this audit)

#### P1 — No `LICENSE` file
- README badge `[!License](LICENSE)` (line 7) points to a non-existent file; README § "完整链路" line 194 self-reports "仓库当前未内置 LICENSE 文件，请在首次发布前补充" — that's the star-conversion hard blocker called out in the goal prompt.
- **Fix:** add MIT (per goal prompt suggestion).

#### P1 — `.github/` directory missing entirely
- No `ISSUE_TEMPLATE/` (bug_report + feature_request), no `PULL_REQUEST_TEMPLATE.md`, no `workflows/ci.yml`.
- **Impact:** CI status / license / tests badges on README are **static hardcoded text** masquerading as live badges. Using dynamic "passing / 205/205" claims without a CI backing them is misleading for an OSS landing page.
- **Fix:** add issue/PR templates + a real CI workflow so badges can become dynamic (or, minimally, change the badges to static-but-honest wording + dynamic ones that 404 gracefully).

### Soft gaps (P2)

#### P2 — `apps/api/.env` is gitignored (correct, line in .gitignore) but documented nowhere as "create this from .env.example"
- CONTRIBUTING does say to copy; README just says `pnpm install && pnpm dev`. Low friction but minor DX nit.

#### P2 — `turbo.json` has `lint`/`test` depending on `^build`, but no package has a `test` task, so `turbo test` is a no-op loop
- Cosmetic. Add at least a placeholder `echo "no tests"` or remove `test` from the root pipeline.

#### P2 — `docker-compose.yml` lacks `restart: unless-stopped` policies on all three services
- If the container stops (e.g. after laptop sleep), compose won't auto-restart. Minor but polish.

#### P2 — `docker-compose.yml` postgres uses `postgres:16-alpine` with a documented comment that pgvector is unavailable
- Blocked on RAG spike. Not a bug, but worth keeping a `TODO` pointer.

---

## 6. Findings summary (prioritized)

### P0 — Blocking
**None.** The repo builds, runs, and has no security blocker.

### P1 — Important (must-fix for this push)
| # | Finding | Where | Fix |
|---|---------|-------|-----|
| 1 | **No LICENSE file** | repo root | Add MIT |
| 2 | **No `.github/` (issue/PR templates + CI)** | `.github/` | Scaffold templates + CI workflow |
| 3 | **README badges are static-fake** | `README.md` lines 5–11 | Wire CI or rewrite badges to be honest |
| 4 | **`apps/worker` dormant status not obvious** | `apps/worker/README.md` | One-sentence dormancy notice |

### P2 — Nice-to-fix (defer or small-pass)
| # | Finding | Where | Fix |
|---|---------|-------|-----|
| 5 | BullMQ dead deps in `apps/api/package.json` | package.json | Defer to P6 or remove |
| 6 | Orphan old status keys (`draft/diagnosing/ready/summarizing`) on web Review List | `app/reviews/page.tsx` | Drop them |
| 7 | ContextPanel hardcoded placeholder | `MeetingPage.tsx` | Wire to real objective |
| 8 | `@RequirePermissions` coverage partial on `ReviewsController` | `reviews.controller.ts` | Future hardening |
| 9 | README oversells RBAC ("4级平台角色…") while guard is mock | README | Clarify mock posture briefly |
| 10 | Turbo `test` pipeline has no backing task | `turbo.json` | Placeholder or remove |
| 11 | Compose services lack `restart` policies | `docker-compose.yml` | Add `restart: unless-stopped` |
| 12 | Job statusMap / orphan keys duplicates on homepage statusMap | `app/reviews/page.tsx` + possibly others | De-dup |

### Deferred-to-P6 (explicitly out of this push)
- BullMQ → multi-process queue
- AgentRuntime worker-process extraction (worker scaffold kept, real implementation for P6)
- Real JWT validation instead of mock guard
- Cost telemetry, OTel, full e2e, Jest coverage

---

## 7. Conclusion

The **core engine (orchestrator + RBAC + provider adapter) is production-grade for a deliberate single-process MVP**. This push has **zero P0**, **4 P1s** (all in the facial layer: LICENSE / GitHub templates / README badge honesty / worker dormancy notice), and **~8 P2s** (mostly hygiene). The codebase is not carrying architectural debt worth flagging; the real gap between "runs" and "starable" is 100% in the **GitHub front matter** — license, issue/PR templates, real CI, and honest README badges.

Recommended order for the next phases:
1. **Phase 2 — Fix**: P1 1–4 + P2 6,7,11 (mechanical; low-risk).
2. **Phase 4 — GitHub polish**: README upgrade (CTA, design rationale, comparison table), issue/PR/CI templates, switch badges to dynamic.
3. **Phase 3 — Polish**: already covered by 2 (.env.example already exists; demo script `setup-demo-review.js` works).
4. **Phase 5 — Roadmap**: Next_Steps.md derived from the P2 list rolled into P6 tasks.
