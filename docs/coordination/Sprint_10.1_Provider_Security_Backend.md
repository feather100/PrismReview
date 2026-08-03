# Sprint 10.1 — Provider Security Emergency Hardening (Backend Contract)

> Sprint: 10.1
> Owner: reasonix (backend implementation)
> Review: qoderwork (review only, no code changes)
> Gate: Codex / User
> Baseline: docs/architecture-remediation-plan-2026-07-22 Sprint 10.1
> Branch: eature/sprint-10.1-provider-security
> Last Updated: 2026-07-29

---

## 1. 目标

关闭无需大范围重构即可修复的密钥、SSRF 和外部调用旁路。

## 2. 范围

### 2.1 In Scope

- Provider DTO、Service、Policy
- Review 创建 DTO、Service
- 相关 Schema / Migration
- Provider 专项测试、SSRF 测试
- QueueService adapter 解析逻辑
- ALLOW_EXTERNAL_MODEL_CALLS 开关管控

### 2.2 Out of Scope (Sprint 10.1 禁止)

- 不新增真实 Provider
- 不调用真实付费模型做验证
- 不修改前端代码（零前端改动）
- 不删除旧 QueueService 兼容路径
- 不触碰状态机、Checkpoint、Worker 执行链路
- 不新增依赖

---

## 3. 契约变更

### 3.1 CreateReviewDto 变更

**Before:**
`	s
export class ProviderOverrideDto {
  @IsEnum(['mock', 'openai_compatible']) provider: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() baseUrl?: string;
  @IsOptional() @IsString() apiKey?: string;  // ← 删除
}

export class CreateReviewDto {
  // ...
  @IsOptional() @ValidateNested() @Type(() => ProviderOverrideDto)
  provider?: ProviderOverrideDto;
}
`

**After:**
`	s
export class CreateReviewDto {
  @IsString() title: string;
  @IsString() objective: string;
  @IsOptional() @IsString() content?: string;
  @IsOptional() @IsEnum(['enterprise', 'code-review', 'research', 'thesis', 'round_robin', 'free_debate'])
  mode?: string;
  @IsOptional() @IsString() llmProviderId?: string;  // 新增：只接受 Provider ID
  @IsOptional() @IsEnum(['zh', 'en']) lang?: string;
}
`

### 3.2 Review 模型变更

- **删除** providerConfig JSON 列（不再存储明文 apiKey）
- **新增** llmProviderId UUID 列，外键关联 LlmProvider.id（nullable）
- **保留** providerOverride 列（仅存储 provider 类型字符串 'mock' | 'openai_compatible' | 'lmstudio'）

### 3.3 LlmProvider 模型变更

- **新增** 	enantId UUID 列，外键关联 Tenant.id（nullable for migration）
- **新增** 复合唯一约束 @@unique([tenantId, name])（替代全局 @unique on name）

### 3.4 新增 ProviderPolicy

`	s
// modules/reviews/provider/provider-policy.ts
export interface ProviderActionContext {
  tenantId: string;
  userId: string;
  action: 'create' | 'update' | 'delete' | 'activate' | 'test' | 'completion';
}

export class ProviderPolicy {
  constructor(private readonly config: {
    allowExternalModelCalls: boolean;
    allowedProviders: string[];
  }) {}

  assertAllowed(ctx: ProviderActionContext): void;
  canUseExternalModelCalls(tenantId: string): boolean;
}
`

---

## 4. 行为契约

### 4.1 Review 创建流程

1. 用户提交 CreateReviewDto（含可选 llmProviderId）
2. 若提供 llmProviderId：
   a. 查询 LlmProvider 记录
   b. 校验 provider.tenantId === user.tenantId
   c. 校验 provider.status !== 'deleted'
   d. 若 provider.provider !== 'mock'，调用 ProviderPolicy.assertAllowed() 检查外部调用开关
3. 写入 Review：
   - llmProviderId = 提供的 ID
   - providerOverride = provider.provider（类型字符串）
   - **不再写入** providerConfig
4. 返回 ReviewResponseDto（不含任何 key 信息）

### 4.2 Provider 操作流程

所有 Provider 操作（create/update/delete/activate/test/completion）必须：
1. 通过 ProviderPolicy.assertAllowed() 检查
2. 对于 test/completion 操作，额外检查 canUseExternalModelCalls(tenantId)

### 4.3 QueueService Adapter 解析变更

**Before:**
`	s
private async resolveAdapter(payload: any): Promise<ModelAdapter> {
  const cfg: any = payload?.providerConfig;
  // ... 从 cfg.apiKey 获取明文 key
}
`

**After:**
`	s
private async resolveAdapter(payload: any): Promise<ModelAdapter> {
  const llmProviderId: string | undefined = payload?.llmProviderId;
  if (!llmProviderId) return this.defaultAdapter;
  // 从 DB 查询 LlmProvider 记录（已通过 tenant 校验）
  // 使用 LlmProviderService 的加密 key 解密
  // 不直接从 payload 获取任何 key 信息
}
`

---

## 5. 数据迁移策略

### 5.1 Migration: provider_tenant_id_backfill

`sql
-- 1. 添加 nullable tenantId 列
ALTER TABLE "llm_providers" ADD COLUMN "tenant_id" UUID;

-- 2. 回填现有数据：关联到第一个 tenant（或创建系统 tenant）
UPDATE "llm_providers" SET "tenant_id" = (SELECT id FROM "tenants" LIMIT 1)
WHERE "tenant_id" IS NULL;

-- 3. 添加 FK 约束和索引
ALTER TABLE "llm_providers" ADD CONSTRAINT "llm_providers_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
CREATE INDEX "llm_providers_tenant_id_idx" ON "llm_providers"("tenant_id");

-- 4. 修改 name 唯一约束为复合唯一
ALTER TABLE "llm_providers" DROP CONSTRAINT "llm_providers_name_key";
ALTER TABLE "llm_providers" ADD CONSTRAINT "llm_providers_tenant_id_name_key"
  UNIQUE ("tenant_id", "name");
`

### 5.2 Migration: review_provider_ref

`sql
-- 1. 添加 llmProviderId 列
ALTER TABLE "reviews" ADD COLUMN "llm_provider_id" UUID;

-- 2. 迁移现有数据：从 providerConfig 中提取（如有对应 LlmProvider）
-- 3. 删除 providerConfig 列
ALTER TABLE "reviews" DROP COLUMN "provider_config";

-- 4. 添加 FK 约束
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_llm_provider_id_fkey"
  FOREIGN KEY ("llm_provider_id") REFERENCES "llm_providers"("id");
`

---

## 6. 验收标准

- [ ] 数据库中不存在新写入的明文 Provider Key
- [ ] ALLOW_EXTERNAL_MODEL_CALLS=false 时，任何用户输入都不能启用外部调用
- [ ] 所有 SSRF 阻断用例返回 4xx 且不会发出网络请求
- [ ] API/Web 	sc 0 errors
- [ ] Jest 全绿
- [ ] Provider 专项测试通过
- [ ] SSRF 测试通过
- [ ] Secret Scan 干净
- [ ] 默认 Mock 行为不变
- [ ] pnpm build 通过

---

## 7. 修改文件清单

| 文件 | 操作 |
|------|------|
| pps/api/prisma/schema.prisma | 修改：LlmProvider 加 tenantId, Review 改列 |
| pps/api/src/modules/reviews/dto/create-review.dto.ts | 修改：删除 ProviderOverrideDto, 加 llmProviderId |
| pps/api/src/modules/reviews/reviews.service.ts | 修改：createReview 逻辑 |
| pps/api/src/modules/reviews/queue/queue.service.ts | 修改：resolveAdapter 逻辑 |
| pps/api/src/modules/llm-provider/llm-provider.service.ts | 修改：加 tenant 校验 |
| pps/api/src/modules/reviews/provider/provider-policy.ts | 新增 |
| pps/api/src/tests/provider-security.spec.ts | 新增 |
| pps/api/src/tests/ssrf.spec.ts | 新增 |
| pps/api/prisma/migrations/20260729..._provider_security/ | 新增 migration |
| docs/coordination/Sprint_10.1_Provider_Security_Backend.md | 新增（本文档） |

---

## 8. 回滚策略

- Migration 可逆：providerConfig 列数据在 migration 前已备份到临时表
- DTO 变更：保留 providerConfig 列在 schema 中 nullable 一个 Sprint
- Code 变更：feature branch 可整体 revert
- 默认 Mock 不受影响
