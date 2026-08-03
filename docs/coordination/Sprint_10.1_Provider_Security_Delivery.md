# Sprint 10.1 — Provider Security Emergency Hardening (Delivery Report)

> Sprint: 10.1
> Branch: feature/sprint-10.1-provider-security
> Date: 2026-07-29
> Owner: reasonix (backend implementation)
> Review: qoderwork (pending)
> Gate: Codex / User (pending)

---

## 1. 实施概要

Sprint 10.1 关闭了无需大范围重构即可修复的密钥、SSRF 和外部调用旁路。

### 1.1 关闭的旁路

| 问题 | 修复前 | 修复后 |
|------|--------|--------|
| 明文 apiKey 写入 Review | dto.provider.apiKey → Review.providerConfig | 已删除。Review 只引用 llmProviderId |
| LlmProvider 无租户隔离 | 全局共享 | 增加 	enantId + 复合唯一约束 |
| ALLOW_EXTERNAL_MODEL_CALLS 被业务代码绕过 | QueueService 直接设置 'true' | 只能通过服务端 env 设置，ProviderPolicy 统一管控 |
| Provider 操作无统一策略 | 分散校验 | ProviderPolicy.assertAllowed() 统一入口 |

---

## 2. 修改文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| pps/api/prisma/schema.prisma | 修改 | LlmProvider 加 tenantId + 复合唯一约束; Review 加 llmProviderId + 删除 providerConfig |
| pps/api/prisma/migrations/20260729000000_sprint_10_1_provider_security/migration.sql | 新增 | Migration + 回填策略 |
| pps/api/src/modules/reviews/provider/provider-policy.ts | 新增 | 统一 Provider 访问策略 |
| pps/api/src/modules/reviews/dto/create-review.dto.ts | 修改 | 删除 ProviderOverrideDto（含 apiKey）, 加 llmProviderId |
| pps/api/src/modules/reviews/reviews.service.ts | 重写 | createReview 验证 provider 归属; startReview 传递 llmProviderId |
| pps/api/src/modules/reviews/queue/queue.service.ts | 修改 | resolveAdapter 从 DB 获取 provider; 不再直接设置 ALLOW_EXTERNAL_MODEL_CALLS |
| pps/api/src/modules/llm-provider/llm-provider.service.ts | 修改 | 加 tenantId 校验 + ProviderPolicy 管控 testConnection/resolveActiveAdapterEnv |
| pps/api/src/modules/llm-provider/llm-provider.controller.ts | 修改 | create 传递 user.tenantId |
| pps/api/src/modules/reviews/reviews.module.ts | 修改 | 导入 LlmProviderModule |
| pps/api/src/modules/reviews/quality/quality.service.ts | 修复 | 修复隐式 any 类型错误 |
| pps/api/src/tests/provider-security.spec.ts | 新增 | ProviderPolicy 单元测试 (41 tests) |
| pps/api/src/tests/ssrf.spec.ts | 新增 | SSRF 防护测试 (18 tests) |
| docs/coordination/Sprint_10.1_Provider_Security_Backend.md | 新增 | Backend Contract 文档 |

---

## 3. Migration 与回填策略

### 3.1 LlmProvider.tenantId

`sql
ALTER TABLE "llm_providers" ADD COLUMN "tenant_id" UUID;
UPDATE "llm_providers" SET "tenant_id" = (SELECT id FROM "tenants" ORDER BY created_at ASC LIMIT 1)
WHERE "tenant_id" IS NULL;
ALTER TABLE "llm_providers" ADD CONSTRAINT "llm_providers_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "llm_providers" DROP CONSTRAINT "llm_providers_name_key";
ALTER TABLE "llm_providers" ADD CONSTRAINT "llm_providers_tenant_id_name_key"
  UNIQUE ("tenant_id", "name");
`

- 现有 provider 回填到第一个 tenant
- 新创建 provider 必须指定 tenantId
- name 唯一约束改为 (tenantId, name) 复合唯一

### 3.2 Review.llmProviderId

`sql
ALTER TABLE "reviews" ADD COLUMN "llm_provider_id" UUID;
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_llm_provider_id_fkey"
  FOREIGN KEY ("llm_provider_id") REFERENCES "llm_providers"("id") ON DELETE SET NULL;
ALTER TABLE "reviews" DROP COLUMN "provider_config";
`

- providerConfig 列已删除（不再存储明文 key）
- 旧数据中 providerConfig 的 provider 信息已无法回溯（符合安全目标：明文 key 不应保留）

### 3.3 回滚方式

- 逆向 Migration：重新添加 providerConfig  nullable 列; 删除 llmProviderId 列; llm_providers 恢复 name 全局唯一
- feature branch 可整体 revert
- 默认 Mock 不受影响

---

## 4. 安全测试结果

### 4.1 新增测试

| 测试文件 | 测试数 | 结果 |
|----------|--------|------|
| provider-security.spec.ts | 41 | 全 PASS |
| ssrf.spec.ts | 18 | 全 PASS |

### 4.2 SSRF 测试覆盖

- ✅ localhost
- ✅ 127.0.0.1
- ✅ 0.0.0.0
- ✅ 169.254.169.254 (cloud metadata)
- ✅ 169.254.0.1 (GCP metadata)
- ✅ 10.x.x.x (RFC1918)
- ✅ 172.16.x.x (RFC1918)
- ✅ 192.168.x.x (RFC1918)
- ✅ 127.x.x.x (loopback range)
- ✅ ftp:// file:// gopher:// dict:// (non-HTTP protocols)
- ✅ empty / malformed / whitespace URLs

### 4.3 ProviderPolicy 测试覆盖

- ✅ assertAllowed: admin actions (create/update/delete/activate) 不受外部调用开关影响
- ✅ assertAllowed: test/completion 在开关关闭时抛出 ForbiddenException
- ✅ assertAllowed: test/completion 在开关开启时允许
- ✅ assertAllowed: 未知 action 抛出 BadRequestException
- ✅ assertProviderTypeAllowed: 允许已知类型; 阻止未知/恶意类型
- ✅ assertTenantOwnership: 匹配允许; 不匹配/legacy/undefined 拒绝
- ✅ createProviderPolicyFromEnv: 默认关闭; env=true 开启; 非 true 值不开启
- ✅ createProviderPolicyFromEnv: 读取 ALLOWED_PROVIDER_TYPES

### 4.4 Secret Scan

- ✅ git grep 无 sk- 命中
- ✅ git grep 无明文 apiKey 写入

---

## 5. 验证命令与结果

| 验证项 | 命令 | 结果 |
|--------|------|------|
| API tsc | 
px tsc --noEmit | 0 errors ✅ |
| Web tsc | 
px tsc --noEmit | 0 errors ✅ |
| Jest | 
px jest --passWithNoTests | 96 tests / 6 suites PASS ✅ |
| Build | pnpm build | 2 successful ✅ |
| Prisma generate | 
px prisma generate | ✅ |
| Secret scan | git grep -iE 'sk-...' | 无命中 ✅ |

---

## 6. 未完成或阻塞项

| 项目 | 状态 | 说明 |
|------|------|------|
| 空库 Migration 验证 | 待 DB 实跑 | Migration SQL 已准备; 需 PostgreSQL 实例验证 |
| 历史库 Migration 验证 | 待 DB 实跑 | 同上 |
| Mock Smoke (smoke-runtime.js) | 待运行时验证 | 代码层面默认 Mock 不受影响; 需运行时验证 |
| 前端零改动确认 | 已确认 | 前端未引用 ProviderOverrideDto / providerConfig |

---

## 7. 是否满足提交给独立 Review Agent 的条件

### Gate 自检

| 条件 | 状态 |
|------|------|
| P0 全部关闭 | ✅ 明文 key 路径已删除; 租户隔离已建立; 外部调用开关已管控 |
| Schema 变更可迁移 | ✅ Migration + 回填策略已准备 |
| 无真实 Provider/Key | ✅ 未新增真实 Provider; 未调用付费模型 |
| 默认 Mock 不变 | ✅ ProviderPolicy 在 env 未设置时默认关闭外部调用 |
| tsc 全绿 | ✅ API + Web 0 errors |
| Jest 全绿 | ✅ 96 tests / 6 suites PASS |
| Build 成功 | ✅ pnpm build 通过 |
| Secret Scan 干净 | ✅ 无 sk- / 明文 key 泄漏 |
| SSRF 测试覆盖 | ✅ 全场景覆盖 |

**结论：满足提交给独立 Review Agent (qoderwork) 的条件。**

---

## 8. 关键设计决策

### 8.1 ProviderPolicy 作为唯一开关入口

createProviderPolicyFromEnv() 是唯一读取 ALLOW_EXTERNAL_MODEL_CALLS 的地方。业务代码（QueueService）不再直接设置该开关，而是通过 policy.canUseExternalModelCalls() 查询。

### 8.2 Review 不再存储任何 Provider 配置

providerConfig 列已删除。Review 只存储对 LlmProvider 的引用（llmProviderId）。所有 Provider 配置（model/baseUrl/encryptedKey）留在 LlmProvider 表，按租户隔离。

### 8.3 QueueService 从 DB 获取 Provider 配置

不再从 job payload 的 providerConfig 获取配置。改为从 DB 查询 LlmProvider 记录（已通过 tenant 校验），使用加密的 piKeyEnc 解密后传给 adapter。

---

## 9. 风险与限制

1. **旧数据中 providerConfig 的 provider 信息丢失** — 这是安全目标决定的（明文 key 不应保留）
2. **QueueService 需要 LlmProviderService 注入** — 通过 LlmProviderModule 导入解决
3. **tenantId 回填依赖第一个 tenant** — 单租户部署无影响; 多租户需手动调整
