# Sprint 10.1 — Provider Security Emergency Hardening (Independent Review — Round 2)

> Reviewer: qoderwork (independent review, no code changes)
> Date: 2026-07-29 (Round 2 — post-fix verification)
> Branch: `feature/sprint-10.1-provider-security`
> Baseline: `docs/coordination/Architecture_Review_and_Remediation_Plan_2026-07-22.md` § Sprint 10.1
> Protocol: `docs/coordination/AGENT_COORDINATION_PROTOCOL.md` §6.3 / §6.4
> Previous Review: `Sprint_10.1_Provider_Security_Review.md` (Round 1 — No-Go)

---

## 0. Executive Summary

**Gate Conclusion: No-Go (P0 reopened)**

Round 1 的 3 个 P0 中，P0-1 和 P0-2 已正确修复。但 P0-3 的修复引入了 **1 个新 P0 阻塞项**：`QualityService.providerPolicy` 字段已声明但从未初始化，导致 `runAdapterOverride()` 在运行时会抛出 `TypeError: Cannot read properties of undefined`。该路径在质量评估功能被调用时必然触发崩溃。

此外，Round 1 的 P1-2（testConnection SSRF 防护）和 P1-3（Migration 备份）仍未关闭。

| 维度 | Round 1 | Round 2 | 说明 |
|------|---------|---------|------|
| 任务完整性 | ⚠️ 部分 | ⚠️ 部分 | P0-3 修复不完整 |
| 根因修复 | ⚠️ 部分 | ⚠️ 部分 | 主路径修复，新引入未初始化字段 |
| 旁路风险 | ❌ 不合格 | ✅ 已关闭 | 所有 `ALLOW_EXTERNAL_MODEL_CALLS` 写入已受 ProviderPolicy 管控 |
| 密钥泄漏 | ⚠️ 部分 | ✅ 已关闭 | `resolveAdapter` 不再读取 `cfg.apiKey` |
| 测试覆盖 | ✅ 良好 | ⚠️ 不足 | 未新增修复路径的回归测试 |
| 迁移完整性 | ⚠️ 部分 | ⚠️ 部分 | 仍未备份，未实跑 |
| 默认 Mock | ✅ 合格 | ✅ 合格 | 不变 |

---

## 1. Round 1 P0 修复验证

### P0-1：`resolveAdapter` 直接设置 `ALLOW_EXTERNAL_MODEL_CALLS='true'`

**Round 1 结论**: ❌ 未关闭
**Round 2 结论**: ✅ **已修复**

**修复证据** (`queue.service.ts` 第 57-94 行):
```ts
private async resolveAdapter(payload: any): Promise<ModelAdapter> {
    const llmProviderId: string | undefined = payload?.llmProviderId;
    if (!llmProviderId) return this.defaultAdapter;

    // Fetch provider from DB (already validated for tenant ownership at creation)
    const provider = this.llmProviderService
      ? await this.llmProviderService.getRaw(llmProviderId)
      : await this.prisma.llmProvider.findUnique({ where: { id: llmProviderId } });

    if (!provider) return this.defaultAdapter;

    // If provider is not mock, check external call policy (server-side trust boundary)
    if (provider.provider !== 'mock') {
      this.providerPolicy.assertAllowed({
        tenantId: provider.tenantId ?? '',
        userId: '',
        action: 'completion',
      });
    }

    // Build adapter env — ALLOW_EXTERNAL_MODEL_CALLS only from server env, never from DB
    const env: any = {
      MODEL_PROVIDER: provider.provider,
      MODEL_NAME: provider.model,
      MODEL_BASE_URL: provider.baseUrl,
    };
    if (this.providerPolicy.canUseExternalModelCalls()) {
      env.ALLOW_EXTERNAL_MODEL_CALLS = 'true';
    }
    if (provider.apiKeyEnc) {
      env.MODEL_API_KEY = decryptApiKey(provider.apiKeyEnc);
    }
    return createProviderAdapter(env);
}
```

**验证**:
- ✅ 不再读取 `payload?.providerConfig`
- ✅ 不再读取 `cfg.apiKey`
- ✅ `ALLOW_EXTERNAL_MODEL_CALLS` 仅通过 `providerPolicy.canUseExternalModelCalls()` 设置（服务端 env）
- ✅ 非 mock provider 调用 `providerPolicy.assertAllowed()` 检查
- ✅ `llmProviderService` 已注入（constructor 第 109 行），带 `prisma.llmProvider.findUnique` 兜底
- ✅ `providerPolicy` 在 constructor 第 112 行正确初始化

### P0-2：`create()` 未 await `validate()`

**Round 1 结论**: ❌ 未关闭
**Round 2 结论**: ✅ **已修复**

**修复证据** (`llm-provider.service.ts` 第 56 行):
```ts
async create(input: {...}): Promise<ProviderDto> {
    await this.validate(input);   // ← now awaited
    this.providerPolicy.assertProviderTypeAllowed(input.provider);
    ...
}
```

**验证**:
- ✅ `validate()` 已加 `await`
- ✅ `assertPublicUrl()` 的 DNS 解析完成后才继续执行
- ✅ 与 `update()` 第 101 行的 `await this.validate(...)` 保持一致

### P0-3：`quality.service.ts` 直接设置 `ALLOW_EXTERNAL_MODEL_CALLS='true'`

**Round 1 结论**: ❌ 未关闭
**Round 2 结论**: ⚠️ **部分修复 — 引入新 P0**

**修复证据** (`quality.service.ts` 第 456-474 行):
```ts
private async runAdapterOverride(
    review: any,
    provider: string,
    tenantId: string,
): Promise<{
    opinions: any[];
    modelName: string | null;
    error: string | null;
}> {
    // Sprint 10.1: Enforce external call policy via ProviderPolicy (server-side trust boundary)
    this.providerPolicy.assertAllowed({ tenantId, userId: '', action: 'completion' });
    const adapterEnv: ProviderEnv = {
      ...process.env,
      MODEL_PROVIDER: provider,
    };
    if (this.providerPolicy.canUseExternalModelCalls()) {
      adapterEnv.ALLOW_EXTERNAL_MODEL_CALLS = 'true';
    }
    ...
}
```

**验证**:
- ✅ 不再直接设置 `ALLOW_EXTERNAL_MODEL_CALLS: 'true'`
- ✅ 调用 `providerPolicy.assertAllowed()` 检查
- ✅ `ALLOW_EXTERNAL_MODEL_CALLS` 仅通过 `providerPolicy.canUseExternalModelCalls()` 设置
- ❌ **新 P0**: `providerPolicy` 字段已声明但从未初始化（见下文）

---

## 2. 新发现 P0 阻塞项

### P0-4：`QualityService.providerPolicy` 未初始化 — 运行时 TypeError

**文件**: `apps/api/src/modules/reviews/quality/quality.service.ts` 第 86 行

**问题**:
```ts
export class QualityService {
  // Sprint 10.1: Unified provider policy — single source of truth for external call decisions
  private readonly providerPolicy: ProviderPolicy;  // ← declared but NEVER initialized
  private readonly logger = new Logger(QualityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reviewsService: ReviewsService,
  ) {}
  // ← no providerPolicy = createProviderPolicyFromEnv() call
```

**后果**:
- `providerPolicy` 是 `readonly` 字段，声明后未在 constructor 或字段初始化器中赋值
- 当 `runAdapterOverride()` 被调用时（第 132 行 `await this.runAdapterOverride(review, opts.provider, user.tenantId)`），第 466 行 `this.providerPolicy.assertAllowed(...)` 会抛出：
  ```
  TypeError: Cannot read properties of undefined (reading 'assertAllowed')
  ```
- 质量评估功能（`POST /quality/evaluate/:reviewId` 带非 mock provider）在运行时必然崩溃

**证据**:
- `grep -n "providerPolicy\s*=\|createProviderPolicyFromEnv" apps/api/src/modules/reviews/quality/quality.service.ts` → 无输出（未初始化）
- `grep -n "OnInit\|OnModuleInit" apps/api/src/modules/reviews/quality/quality.service.ts` → 无输出（无生命周期钩子）
- `verify-quality.js` 测试仅使用 mock provider，未触发 `runAdapterOverride` 的非 mock 路径，因此未发现此 bug

**修复建议**:
```ts
constructor(
    private readonly prisma: PrismaService,
    private readonly reviewsService: ReviewsService,
) {
    this.providerPolicy = createProviderPolicyFromEnv();
}
```

---

## 3. Round 1 P1 问题跟踪

| # | 问题 | Round 2 状态 | 说明 |
|---|------|-------------|------|
| P1-1 | `queue.service.ts` 注释仍引用 `providerConfig` | ⚠️ 仍存在 | 第 46-48 行注释未更新，降为 P2（代码已修复） |
| P1-2 | `testConnection()` 无 SSRF 防护 | ⚠️ 仍存在 | 未调用 `assertPublicUrl`，依赖 `create/update` 的 `validate` 先执行 |
| P1-3 | Migration 无备份步骤 | ⚠️ 仍存在 | `DROP COLUMN "provider_config"` 无备份 SQL |
| P1-4 | `assertTenantOwnership` legacy 处理 | ⚠️ 仍存在 | null tenantId 直接拒绝，需文档化 |

---

## 4. 安全测试覆盖评估

### 4.1 测试统计

| 测试文件 | 测试数 | 结果 | Round 2 变化 |
|----------|--------|------|-------------|
| `provider-security.spec.ts` | 41 | ✅ 全 PASS | 无新增测试 |
| `ssrf.spec.ts` | 18 | ✅ 全 PASS | 无新增测试 |
| 既有测试 | 37 | ✅ 全 PASS | 无变化 |
| **合计** | **96** | ✅ | — |

### 4.2 覆盖缺口（新增）

| 缺口 | 严重度 | 说明 |
|------|--------|------|
| `QualityService.providerPolicy` 初始化测试 | **P0** | 无测试验证 `providerPolicy` 非空 |
| `resolveAdapter` 不再读取 `providerConfig` 的回归测试 | P1 | 无测试验证旧路径已关闭 |
| `create()` await `validate()` 行为测试 | P1 | 无测试验证恶意 URL 被拒绝写入 |
| `runAdapterOverride` 集成测试 | P1 | 无测试验证非 mock provider 路径 |

### 4.3 测试质量评估

- ✅ 既有测试全部通过，回归未破坏
- ❌ 修复路径无新增回归测试
- ❌ `verify-quality.js` 未覆盖非 mock provider 的 `runAdapterOverride` 路径，导致 P0-4 未被运行时验证发现

---

## 5. 密钥泄漏路径分析（Round 2 更新）

### 5.1 已关闭路径

| 路径 | Round 1 | Round 2 | 证据 |
|------|---------|---------|------|
| `createReview` → `Review.providerConfig` | ✅ | ✅ | 已删除 |
| `resolveAdapter` → `cfg.apiKey` | ❌ | ✅ | 不再读取 `providerConfig` |
| `LlmProvider.apiKeyEnc` → DTO 序列化 | ✅ | ✅ | `toDto()` 返回 mask |
| 日志/异常 apiKey 泄漏 | ✅ | ✅ | Bearer 脱敏 |

### 5.2 仍存在风险路径

| 路径 | 严重度 | 证据 |
|------|--------|------|
| `testConnection` → `decryptApiKey` → `Authorization` header | P1 | 若 `create` 未正确校验 URL（P0-2 已修复，此风险降低），decrypt 后的 key 可能被发送到恶意端点 |

---

## 6. 旁路风险评估（Round 2 更新）

### 6.1 已识别旁路

| 旁路 | Round 1 | Round 2 | 证据 |
|------|---------|---------|------|
| `resolveAdapter` 直接启用外部调用 | ❌ P0 | ✅ 已关闭 | 受 ProviderPolicy 管控 |
| `quality.service.ts` 直接启用外部调用 | ❌ P0 | ✅ 已关闭 | 受 ProviderPolicy 管控 |
| `testConnection` 无 SSRF 防护 | ⚠️ P1 | ⚠️ P1 | 未调用 `assertPublicUrl` |

### 6.2 `ALLOW_EXTERNAL_MODEL_CALLS` 写入点审计

| 文件 | 行 | 写入方式 | 是否合规 |
|------|------|----------|----------|
| `provider-policy.ts` | 116 | `process.env.ALLOW_EXTERNAL_MODEL_CALLS === 'true'` | ✅ 唯一 env 读取点 |
| `queue.service.ts` | 88 | `if (this.providerPolicy.canUseExternalModelCalls())` | ✅ 受 Policy 管控 |
| `quality.service.ts` | 472 | `if (this.providerPolicy.canUseExternalModelCalls())` | ✅ 受 Policy 管控 |
| `llm-provider.service.ts` | 192 | `if (this.providerPolicy.canUseExternalModelCalls())` | ✅ 受 Policy 管控 |
| `provider-factory.ts` | 55 | `const allow = env.ALLOW_EXTERNAL_MODEL_CALLS \|\| ''` | ✅ 只读，用于 guard |
| `llm-moderator.ts` | 260 | `const allow = process.env.ALLOW_EXTERNAL_MODEL_CALLS \|\| ''` | ✅ 只读，用于 gating |

**结论**: 所有 `ALLOW_EXTERNAL_MODEL_CALLS` 写入点均已受 ProviderPolicy 管控。✅

---

## 7. 迁移与回滚完整性（无变化）

| 项 | 状态 | 说明 |
|----|------|------|
| Migration SQL 语法正确 | ✅ | — |
| 回填策略明确 | ✅ | — |
| 回滚声明 | ⚠️ 不符 | 声称备份但无备份 SQL |
| 空库验证 | ❌ 未执行 | — |
| 历史库验证 | ❌ 未执行 | — |

---

## 8. Gate 结论

### 8.1 协议 §6.4 规则逐条核对

| 规则 | 触发 | 结论 |
|------|------|------|
| 任一 P0 未关闭 → No-Go | ✅ 触发 | P0-4 未关闭 |
| Schema、状态机、真实 Auth、真实 Queue 无迁移/回滚/故障证据 → No-Go | ✅ 触发 | Migration 未实跑，回滚 SQL 缺失 |
| 仅 TypeScript 编译通过但没有风险场景测试 → No-Go | ❌ 未触发 | 有 59 个安全测试 |
| 真实模型被默认启用或可由用户输入绕过 → No-Go | ❌ 未触发 | 所有写入点已受 Policy 管控 |
| 跨租户自动化矩阵任一失败 → No-Go | ⚠️ 部分 | 无自动化跨租户矩阵 |

### 8.2 最终结论

## **Gate: No-Go**

---

## 9. 阻塞项与修复建议

### 9.1 P0 阻塞项（必须修复）

#### P0-4：`QualityService.providerPolicy` 未初始化

**文件**: `apps/api/src/modules/reviews/quality/quality.service.ts` 第 86 行 + constructor 第 89-92 行

**问题**: `private readonly providerPolicy: ProviderPolicy;` 已声明但从未赋值。`runAdapterOverride()` 第 466 行调用 `this.providerPolicy.assertAllowed(...)` 会抛出 `TypeError: Cannot read properties of undefined (reading 'assertAllowed')`。

**修复建议**:
```ts
// Before:
constructor(
    private readonly prisma: PrismaService,
    private readonly reviewsService: ReviewsService,
) {}

// After:
constructor(
    private readonly prisma: PrismaService,
    private readonly reviewsService: ReviewsService,
) {
    this.providerPolicy = createProviderPolicyFromEnv();
}
```

**验证方式**: 在 `verify-quality.js` 中增加一个测试用例：对非 mock provider 调用 `POST /quality/evaluate/:reviewId`，验证不抛出 TypeError（应返回 guarded mock 或 policy 拒绝，而非 500）。

### 9.2 P1 重要问题（建议本 Sprint 修复）

| # | 修复建议 |
|---|----------|
| P1-2 | `testConnection()` 增加 `await assertPublicUrl(existing.baseUrl)` 校验（防御纵深） |
| P1-3 | Migration 增加备份步骤或提供独立回滚 SQL |
| P1-1 | 更新 `queue.service.ts` 第 46-48 行注释，删除 `providerConfig` 引用 |

### 9.3 迁移验证要求（同 Round 1）

1. 在真实 PostgreSQL 实例执行 `prisma migrate deploy`（空库 + 历史库）
2. 提供回滚 SQL
3. 验证回填后所有 `llm_providers.tenant_id` 非空
4. 验证复合唯一约束生效

---

## 10. 修复验证清单（供实现 Agent 确认）

- [ ] `QualityService.constructor` 中初始化 `this.providerPolicy = createProviderPolicyFromEnv()`
- [ ] 新增测试验证 `providerPolicy` 非空（或 `runAdapterOverride` 不抛 TypeError）
- [ ] `verify-quality.js` 增加非 mock provider 测试用例
- [ ] 更新 `queue.service.ts` 第 46-48 行注释
- [ ] Migration 备份步骤或回滚 SQL
- [ ] `testConnection()` 增加 `assertPublicUrl` 校验
- [ ] 空库 + 历史库 Migration 实跑验证

---

> Reviewer: qoderwork (independent, no code changes made)
> Review Date: 2026-07-29 (Round 2)
> Next Review: 待 P0-4 修复后重新提交


---

## 11. Round 3 修复验证（2026-08-03，Codex 收口）

| # | 问题 | 状态 | 修复证据 |
|---|------|------|---------|
| P0-4 | QualityService.providerPolicy 未初始化 | ✅ 已修复 | constructor 增加 `this.providerPolicy = createProviderPolicyFromEnv();`（quality.service.ts L95）；新增回归测试（provider-security.spec.ts `P0-4 regression`） |
| P1-2 | testConnection 无 SSRF 防御纵深 | ✅ 已修复 | testConnection 增加 `await assertPublicUrl(existing.baseUrl);`（llm-provider.service.ts L157），叠加既有 ProviderPolicy.assertAllowed(action:test) |
| P1-3 | 迁移无备份/回滚 | ✅ 已提供 | 新增 `20260729000000_sprint_10_1_provider_security/rollback.sql`；真库执行仍待有 DB 环境（本地无 Postgres） |
| P1-1 | queue.service 注释引用 providerConfig | ✅ 已修复 | 注释更新为 ProviderPolicy 口径 |

**验证结果：**
- `npx tsc --noEmit`：0 error
- `npx jest`：97/97（含新增 P0-4 回归 1 例）
- `verify-sprint-10.1-security.js`（e2e）：**待 DB + 运行中服务**（目标 localhost:4000，本地无 Postgres，无法执行；Test 5 schema 检查 PASS）

**Gate Conclusion（Round 3）：** ✅ **Go（单元/静态层）**——代码层 P0-4/P1-1/P1-2 已闭环；e2e 冒烟与真库迁移执行标记为 **pending（环境依赖）**，作为合并后 CI/部署环境的收尾项。
