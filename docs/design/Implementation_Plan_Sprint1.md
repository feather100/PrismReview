# Sprint 1 — SoT-first Implementation Plan

> 依据：`Frontend_Delivery_Spec.md`（Props/缺口）、`schema.prisma`（14 表不变）
> 核心约束：不改 Prisma schema、使用现有表、所有模型调用 Mock、前端缺口 G01/G05/G10/G21/G22/G24 在本轮覆盖
> 日期：2026-07-06

---

## 0. 贯穿策略：camelCase 转换 (G22/G24)

### 0.1 全局转换策略

```
DB (snake_case)
  │ Prisma @map 已处理
  ▼
Prisma Client (camelCase fields)
  │ Service layer: 直接使用 Prisma 的 camelCase
  ▼
DTO (Data Transfer Object — camelCase)
  │ NestJS @SerializeOptions / ClassSerializerInterceptor
  ▼
JSON Response (camelCase)  ← 前端直接消费
```

**具体实施**：
- Prisma schema 中所有字段已用 `@map("snake_case")`，Prisma Client 暴露 `camelCase` 属性名。
- NestJS 全局启用 `ClassSerializerInterceptor`，所有 Controller 返回 DTO class。
- DTO class 使用 `@Expose()` 装饰器，字段名即为 camelCase。
- 不使用自动 `@Transform` 或自定义 interceptor，因为 Prisma 已解决。

**例外处理**：
- `@prisma/client` 枚举值仍为 PascalCase（如 `ReviewStatus.DRAFT`），统一 `.toLowerCase()` 传给前端。
- 前端 `packages/shared-types` 中的枚举都用 `as const` 对象 + string literal union。

### 0.2 错误码映射 (G24)

```typescript
// apps/api/src/common/filters/global-exception.filter.ts
// NestJS ExceptionFilter 统一拦截：

// Prisma 错误 → 业务错误码
//   NotFoundError   → { code: 'NOT_FOUND', status: 404 }
//   UniqueViolation → { code: 'CONFLICT', status: 409 }

// 业务异常 → 自定义 HttpException
//   ForbiddenException      → { code: 'FORBIDDEN', status: 403 }
//   TenantIsolationException → { code: 'TENANT_ISOLATION_VIOLATION', status: 403 }
//   ValidationError         → { code: 'VALIDATION_ERROR', status: 400 }

// 前端 API Client interceptor 映射：
//   401 → 跳转登录
//   403 → 展示 <ForbiddenState>
//   422 → 展示 Alert + 具体 message
//   504 → 展示 "模型调用超时" Alert
//   429 → 展示 "请求过于频繁" Toast
```

---

## 1. Role Service

### 1.1 SoT

```
Source of Truth: agent_roles + agent_role_versions 表
No new tables. No denormalization.
角色定义 = agent_roles.row + agent_role_versions.activeVersion.
```

### 1.2 目录结构

```
apps/api/src/modules/roles/
├─ roles.module.ts
├─ roles.controller.ts
├─ roles.service.ts
├─ dto/
│  ├─ create-role.dto.ts
│  ├─ update-role.dto.ts
│  ├─ create-version.dto.ts
│  └─ role-response.dto.ts
├─ guards/
│  └─ role-access.guard.ts        # 校验 tenant_id 归属
└─ tests/
   ├─ roles.service.spec.ts
   └─ roles.controller.spec.ts
```

### 1.3 API 端点

| Method | Path | 说明 | 状态 |
|---|---|---|---|
| GET | `/api/roles` | 角色列表（支持 `?excludeIds=` 实现 G05） | 实现 |
| GET | `/api/roles?available_for_review={reviewId}` | 可用角色（排除已选的） | 实现 G05 |
| POST | `/api/roles` | 创建自定义角色 | 实现 |
| GET | `/api/roles/{roleId}` | 角色详情（含 activeVersion） | 实现 |
| POST | `/api/roles/{roleId}/versions` | 创建新版本 | 实现 |
| POST | `/api/roles/{roleId}/activate-version` | 激活版本 | 实现 |
| POST | `/api/roles/{roleId}/disable` | 禁用角色 | 实现 |
| DELETE | `/api/roles/{roleId}` | 删除角色（软删 = status=deleted） | 实现 |

### 1.4 核心业务流程

#### 1.4.1 GET /api/roles （列表）

```typescript
// Controller 签名
@Get()
@UseGuards(RoleAccessGuard)
async listRoles(
  @Query('excludeIds') excludeIds?: string,  // 逗号分隔
  @Query('available_for_review') reviewId?: string,
): Promise<RoleBriefDto[]> { ... }

// Service 逻辑
async listRoles(tenantId: string, filters: { excludeIds?: string[]; reviewId?: string }) {
  const where: Prisma.AgentRoleWhereInput = {
    tenantId,
    status: { not: 'deleted' },
  };

  // G05: 如果传了 reviewId，从 review.roleSelection 读取已选角色 ID
  if (filters.reviewId) {
    const review = await this.prisma.review.findUnique({
      where: { id: filters.reviewId },
      select: { roleSelection: true },
    });
    if (review?.roleSelection) {
      const selected = (review.roleSelection as any[])?.map(r => r.roleId) ?? [];
      where.id = { notIn: selected };
    }
  } else if (filters.excludeIds?.length) {
    where.id = { notIn: filters.excludeIds };
  }

  const roles = await this.prisma.agentRole.findMany({
    where,
    include: {
      activeVersion: {
        select: { id: true, version: true, dimensions: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return roles.map(toRoleBriefDto);
}
```

#### 1.4.2 角色 DTO

```typescript
// role-response.dto.ts
class RoleBriefDto {
  @Expose() id: string;
  @Expose() code: string;           // "CTO"
  @Expose() name: string;           // "技术审核员"
  @Expose() type: string;           // "preset" | "custom"
  @Expose() status: string;
  @Expose() activeVersion: { id: string; version: number; dimensions: string[] };
  @Expose() createdAt: string;
}

class RoleDetailDto extends RoleBriefDto {
  @Expose() description?: string;   // 前端 AgentRoleBrief.description
  @Expose() departmentId?: string;
  @Expose() versions: AgentRoleVersionBriefDto[];
}

class AgentRoleVersionBriefDto {
  @Expose() id: string;
  @Expose() version: number;
  @Expose() dimensions: string[];
  @Expose() createdAt: string;
}
```

### 1.5 预置 5 角色 Seed

seed.ts 已写，使用 `upsert` 保证幂等。当前版本包含 `systemPrompt` + `dimensions` + `outputSchema`。

### 1.6 不做事项

- 不做角色市场（marketplace type 预留但未实现）
- 不做跨部门发布（department 范围验证延后）
- 不做 Prompt 版本对比

---

## 2. Review Draft Service

### 2.1 SoT

```
Source of Truth: reviews 表
roleSelection = reviews.row.role_selection (JSON)
DiagnosisResult = reviews.row.diagnosis (JSON)
无新表 ReviewRole。无新字段。
JSON 结构在 API 层用 TypeScript interface 约束，不在 DB 层验证。
```

### 2.2 目录结构

```
apps/api/src/modules/reviews/
├─ reviews.module.ts
├─ reviews.controller.ts
├─ reviews.service.ts
├─ reviews.gateway.ts              # SSE 流 (G10)
├─ dto/
│  ├─ create-review.dto.ts
│  ├─ review-response.dto.ts
│  ├─ diagnosis-response.dto.ts     # G01: DiagnosisResult JSON schema
│  ├─ role-selection.dto.ts
│  └─ review-list-query.dto.ts
├─ guards/
│  └─ review-ownership.guard.ts
└─ tests/
   ├─ reviews.service.spec.ts
   └─ reviews.controller.spec.ts
```

### 2.3 API 端点

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/reviews` | 创建评审 draft |
| GET | `/api/reviews` | 我的评审列表（支持分页+状态过滤） |
| GET | `/api/reviews/{reviewId}` | 评审详情 |
| POST | `/api/reviews/{reviewId}/diagnose` | 触发异步诊断（Mock） |
| GET | `/api/reviews/{reviewId}/diagnosis` | 获取诊断结果 |
| GET | `/api/reviews/{reviewId}/diagnose/stream` | SSE 诊断进度流 (G10) |
| POST | `/api/reviews/{reviewId}/roles` | 保存角色选择 |
| POST | `/api/reviews/{reviewId}/start` | 开始评审 |
| POST | `/api/reviews/{reviewId}/interrupt` | 举手打断 |
| POST | `/api/reviews/{reviewId}/resume` | 恢复 |
| POST | `/api/reviews/{reviewId}/summarize` | 强制结束 |

### 2.4 JSON Schema 定义 (G01)

```typescript
// ─── Review.diagnosis 的 JSON 结构 ───
// 存入 DB 时 JSON.stringify，取出时 JSON.parse
// 类型定义放在 dto/diagnosis-response.dto.ts

interface DiagnosisResultJson {
  summary: string;                    // 方案摘要
  tags: string[];                     // 领域标签
  radarDimensions: {
    name: string;                     // "性能", "安全"...
    score: number;                    // 0-100
  }[];
  confidenceScore: number;            // 0-100
  recommendedRoles: {
    roleId: string;                   // AgentRole.id
    roleCode: string;                 // "CTO"
    roleName: string;                 // "技术审核员"
    weight: number;                   // 权重
    reason: string;                   // 推荐理由
  }[];
  // 前端 removable 由 API 层计算：role.type === 'preset' ? false : true
}

// ─── Review.role_selection 的 JSON 结构 ───
interface RoleSelectionJson {
  roles: {
    roleId: string;
    weight: number;                   // 权重
  }[];
  // 前端需要的 roleCode/roleName/removable 由 API 层 JOIN 后计算
}
```

### 2.5 核心业务流程

#### 2.5.1 POST /api/reviews（创建 Draft）

```typescript
// create-review.dto.ts — 前端 POST 的 body
class CreateReviewDto {
  @IsString() title: string;
  @IsString() objective: string;
  @IsOptional() @IsString() content?: string;     // 文本粘贴内容
  @IsOptional() @IsEnum(['round_robin', 'free_debate'])
  mode?: string;
}

// Service 逻辑
async createReview(dto: CreateReviewDto, user: AuthUser) {
  return this.prisma.review.create({
    data: {
      tenantId: user.tenantId,
      createdBy: user.id,
      title: dto.title,
      objective: dto.objective,
      inputType: dto.content ? 'text' : 'text',
      mode: dto.mode ?? 'round_robin',
      status: 'draft',
    },
  });
}
```

#### 2.5.2 POST /api/reviews/{id}/diagnose（Mock 诊断）

```typescript
// Service 逻辑 — 全 Mock，不调模型
async diagnose(reviewId: string, tenantId: string) {
  const review = await this.prisma.review.findFirstOrThrow({
    where: { id: reviewId, tenantId },
  });

  // 更新状态
  await this.prisma.review.update({
    where: { id: reviewId },
    data: { status: 'diagnosing' },
  });

  // Mock 诊断结果 — 模拟 Chairman 输出
  const mockDiagnosis: DiagnosisResultJson = {
    summary: `方案 "${review.title}" 涉及 ${review.objective}，系统自动识别以下风险维度。`,
    tags: ['架构设计', '技术可行性', '高并发'],
    radarDimensions: [
      { name: '架构合理性', score: 72 },
      { name: '技术可行性', score: 85 },
      { name: '性能与扩展性', score: 45 },
      { name: '安全与合规', score: 68 },
      { name: '成本效益', score: 80 },
    ],
    confidenceScore: 82,
    recommendedRoles: [
      { roleId: 'seed-role-cto', roleCode: 'CTO', roleName: '技术审核员', weight: 30, reason: '涉及高并发架构' },
      { roleId: 'seed-role-cfo', roleCode: 'CFO', roleName: '商业控制者', weight: 20, reason: '需评估投入产出' },
      { roleId: 'seed-role-pmo', roleCode: 'PMO', roleName: '交付守护者', weight: 20, reason: '识别排期依赖风险' },
      { roleId: 'seed-role-compliance', roleCode: 'Compliance', roleName: '合规审查员', weight: 15, reason: '涉及数据合规' },
      { roleId: 'seed-role-ua', roleCode: 'UserAdvocate', roleName: '用户代言人', weight: 15, reason: '评估用户体验影响' },
    ],
  };

  await this.prisma.review.update({
    where: { id: reviewId },
    data: {
      diagnosis: JSON.parse(JSON.stringify(mockDiagnosis)),
      status: 'ready',
    },
  });

  return mockDiagnosis;
}
```

#### 2.5.3 SSE 诊断进度流 (G10)

```typescript
// reviews.gateway.ts — 用 NestJS SSE @Sse()
// 路径: GET /api/reviews/{reviewId}/diagnose/stream

@Sse('diagnose/stream')
async diagnoseStream(
  @Param('reviewId') reviewId: string,
  @Req() req: Request,
): Promise<Observable<MessageEvent>> {
  // 验证权限
  // 返回 Observable，依次 emit:
  //   { type: 'progress', data: { percent: 10, stage: '正在分析方案领域标签...' } }
  //   { type: 'progress', data: { percent: 40, stage: '正在匹配评审角色...' } }
  //   { type: 'progress', data: { percent: 70, stage: '正在评估风险维度...' } }
  //   { type: 'progress', data: { percent: 100, stage: '诊断完成' } }
  //   { type: 'complete', data: { diagnosis: DiagnosisResultJson } }

  // Mock 实现：setInterval 每 2s 推一次进度，8s 后 complete
  // 后续替换为从 Redis Pub/Sub 消费 Worker 进度
}
```

#### 2.5.4 POST /api/reviews/{id}/roles（保存角色选择）

```typescript
class SaveRoleSelectionDto {
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  roles: { roleId: string; weight: number }[];

  @IsInt() @Min(100) @Max(100)
  totalWeight: number;  // 前端校验总和=100
}

// Service
async saveRoleSelection(reviewId: string, tenantId: string, dto: SaveRoleSelectionDto) {
  // 验证所有 roleId 属于此 tenant
  const roleIds = dto.roles.map(r => r.roleId);
  const validRoles = await this.prisma.agentRole.findMany({
    where: { id: { in: roleIds }, tenantId, status: 'enabled' },
  });
  if (validRoles.length !== roleIds.length) {
    throw new BadRequestException('ROLE_NOT_FOUND');
  }

  // 保存为 JSON
  await this.prisma.review.update({
    where: { id: reviewId },
    data: {
      roleSelection: JSON.parse(JSON.stringify({ roles: dto.roles })),
    },
  });

  // 返回时 JOIN role 信息，供前端展示
  return this.getRoleSelectionWithDetails(reviewId);
}
```

#### 2.5.5 GET /api/reviews/{id}/diagnosis（带角色详情的响应）

```typescript
// 响应包含 DiagnosisResultJson + 每个 recommendedRole 的 removable 计算
// removable = role.type !== 'preset'
// 在 service 层 JOIN agent_roles 表
async getDiagnosis(reviewId: string, tenantId: string) {
  const review = await this.prisma.review.findFirstOrThrow({
    where: { id: reviewId, tenantId },
  });

  if (!review.diagnosis) return null;

  const diagnosis = review.diagnosis as unknown as DiagnosisResultJson;

  // 查询所有推荐角色的详情，补充 removable
  const roleIds = diagnosis.recommendedRoles.map(r => r.roleId);
  const roles = await this.prisma.agentRole.findMany({
    where: { id: { in: roleIds } },
    select: { id: true, type: true },
  });
  const roleTypeMap = new Map(roles.map(r => [r.id, r.type]));

  return {
    ...diagnosis,
    recommendedRoles: diagnosis.recommendedRoles.map(r => ({
      ...r,
      removable: roleTypeMap.get(r.roleId) !== 'preset',
    })),
  };
}
```

### 2.6 状态机（Review 状态 → 允许的操作）

| 当前状态 | 允许操作 | 下一状态 |
|---|---|---|
| `draft` | POST /diagnose | `diagnosing` |
| `diagnosing` | (自动) | `ready` / `failed` |
| `ready` | POST /roles, POST /start | (不变) / `running` |
| `running` | POST /interrupt, POST /summarize | `interrupted` / `summarizing` |
| `interrupted` | POST /resume, POST /summarize | `running` / `summarizing` |
| `summarizing` | (自动) | `completed` / `failed` |

### 2.7 不做事项

- 不做文件上传（Mock 诊断只处理文本内容）
- 不做真实模型调用
- 不做多轮 state-machine 校验（只做基本状态守卫）

---

## 3. Knowledge Mock Upload Service

### 3.1 SoT

```
Source of Truth: knowledge_documents + knowledge_chunks 表
Mock pipeline: upload → parsing → chunking → "indexed" (跳过真实 embedding)
存储直接用本地文件系统（不依赖 MinIO，留接口抽象）
```

### 3.2 目录结构

```
apps/api/src/modules/knowledge/
├─ knowledge.module.ts
├─ knowledge.controller.ts
├─ knowledge.service.ts
├─ dto/
│  ├─ upload-document.dto.ts
│  ├─ document-response.dto.ts
│  ├─ chunk-response.dto.ts
│  └─ search-test.dto.ts
└─ tests/
```

### 3.3 API 端点

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/knowledge/documents` | 文档列表 |
| POST | `/api/knowledge/documents` | 上传文档（Mock） |
| GET | `/api/knowledge/documents/{documentId}` | 文档详情 |
| GET | `/api/knowledge/documents/{documentId}/chunks` | Chunk 列表 |
| PATCH | `/api/knowledge/chunks/{chunkId}/review-status` | 审核 Chunk |
| POST | `/api/knowledge/search-test` | 检索测试（Mock） |
| POST | `/api/knowledge/documents/{documentId}/reindex` | 重新索引 |

### 3.4 核心业务流程

#### 3.4.1 POST /api/knowledge/documents（Mock 上传）

```typescript
// upload-document.dto.ts
class UploadDocumentDto {
  // 使用 multipart/form-data，NestJS FileInterceptor
  // 前端用 <Upload> 组件
}
```

**Mock 流程**（同步完成，不做异步 Worker）：

```typescript
async uploadDocument(file: Express.Multer.File, user: AuthUser) {
  // 1. 保存文件到本地存储（mock：直接存到 ./data/uploads/{tenantId}/{filename}）
  const localPath = `./data/uploads/${user.tenantId}/${file.originalname}`;
  await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
  await fs.promises.writeFile(localPath, file.buffer);

  // 2. 创建 knowledge_document 记录
  const doc = await this.prisma.knowledgeDocument.create({
    data: {
      tenantId: user.tenantId,
      filename: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      storageUri: localPath,
      status: 'parsing',       // → 立即进入下一阶段
      scope: 'global',
    },
  });

  // 3. Mock 解析 → 分块 → 索引
  //    (模拟 Worker 流程，实际同步执行)
  const mockChunks = this.mockChunkContent(file.originalname);

  const chunkData = mockChunks.map((content, i) => ({
    documentId: doc.id,
    tenantId: user.tenantId,
    content,
    metadata: JSON.parse(JSON.stringify({
      chunkIndex: i,
      page: Math.floor(i / 3) + 1,
      heading: i === 0 ? '概述' : `章节 ${i}`,
    })),
    reviewStatus: 'pending_review',
  }));

  await this.prisma.knowledgeChunk.createMany({ data: chunkData });

  // 4. 更新文档状态为 ready
  await this.prisma.knowledgeDocument.update({
    where: { id: doc.id },
    data: { status: 'ready' },
  });

  return doc;
}

// Mock 分块：根据文件名生成假内容
private mockChunkContent(filename: string): string[] {
  // 返回 3-5 个 mock chunk
  // 真实场景由 unstructured 库解析
  return [
    `# ${filename} — 概述\n\n这是 ${filename} 的摘要内容。系统自动提取的关键信息。`,
    `## 核心规范\n\n方案要求在架构设计中遵循高可用标准，确保 99.9% SLA。`,
    `## 安全要求\n\n所有数据传输需 TLS 1.3 加密，敏感字段列级加密。`,
    `## 部署约束\n\n生产环境使用 Kubernetes 集群，最低 3 节点。`,
  ];
}
```

#### 3.4.2 检索测试（Mock）

```typescript
// POST /api/knowledge/search-test
class SearchTestDto {
  @IsString() query: string;
  @IsOptional() @IsInt() topK?: number;  // 默认 5
}

async searchTest(dto: SearchTestDto, user: AuthUser) {
  // Mock：基于关键词的简单匹配（不调 embedding）
  const chunks = await this.prisma.knowledgeChunk.findMany({
    where: {
      tenantId: user.tenantId,
      reviewStatus: { not: 'deprecated' },
      content: { contains: dto.query, mode: 'insensitive' },
    },
    take: dto.topK ?? 5,
    include: { document: { select: { filename: true } } },
  });

  // 模拟 relevance_score
  return chunks.map((chunk, i) => ({
    chunkId: chunk.id,
    documentId: chunk.documentId,
    document: chunk.document.filename,
    content: chunk.content.substring(0, 200),
    score: Math.round((1 - i / chunks.length) * 100),
    reviewStatus: chunk.reviewStatus,
  }));
}
```

#### 3.4.3 Chunk 审核

```typescript
// PATCH /api/knowledge/chunks/{chunkId}/review-status
class UpdateChunkReviewDto {
  @IsEnum(['approved', 'rejected', 'deprecated'])
  reviewStatus: string;
}

async updateChunkReview(chunkId: string, dto: UpdateChunkReviewDto, user: AuthUser) {
  const chunk = await this.prisma.knowledgeChunk.findFirstOrThrow({
    where: { id: chunkId, tenantId: user.tenantId },
  });

  return this.prisma.knowledgeChunk.update({
    where: { id: chunkId },
    data: { reviewStatus: dto.reviewStatus },
  });
}
```

### 3.5 不做事项

- 不做真实文档解析（unstructured 库延后）
- 不做真实 embedding（pgvector 延后到 RAG Spike）
- 不做 MinIO 集成（本地文件系统 Mock）
- 不做权限 scope 验证（global/role/department 验证延后）

---

## 4. Auth Endpoint (G21)

### 4.1 目录

```
apps/api/src/modules/auth/
├─ auth.module.ts
├─ auth.controller.ts
├─ auth.service.ts
├─ strategies/
│  └─ jwt.strategy.ts               # JWT 验证
├─ guards/
│  ├─ jwt-auth.guard.ts             # 全局验证
│  └─ tenant-guard.ts               # 租户注入
└─ dto/
   └─ auth-user-response.dto.ts
```

### 4.2 GET /api/auth/me

```typescript
// auth-user-response.dto.ts
class AuthUserResponseDto {
  @Expose() id: string;
  @Expose() name: string;
  @Expose() email: string;
  @Expose() tenantId: string;
  @Expose() departmentId?: string;
  @Expose() platformRole: string;
  @Expose() permissions: string[];     // 从 platformRole 派生
}
```

### 4.3 权限派生规则（MVP 硬编码）

```typescript
// auth.service.ts
const ROLE_PERMISSIONS: Record<string, string[]> = {
  super_admin: [
    'review.create', 'review.read.all', 'review.delete',
    'role.read', 'role.write', 'role.delete',
    'kb.upload', 'kb.read', 'kb.delete',
    'admin.access', 'audit.read', 'tenant.manage',
  ],
  enterprise_admin: [
    'review.create', 'review.read.all',
    'role.read', 'role.write',
    'kb.upload', 'kb.read',
    'admin.access', 'audit.read',
  ],
  department_admin: [
    'review.create', 'review.read.department',
    'role.read', 'role.write',
    'kb.upload', 'kb.read',
  ],
  user: [
    'review.create', 'review.read.owned',
    'role.read',
    'kb.read',
  ],
};

getPermissions(platformRole: string): string[] {
  return ROLE_PERMISSIONS[platformRole] ?? ROLE_PERMISSIONS.user;
}
```

---

## 5. 分步实现顺序

```
Phase 1 — 基础设施 (Step 1-3)
  Step 1: Auth module + /api/auth/me (G21)
  Step 2: 全局 ExceptionFilter 错误码映射 (G24)
  Step 3: AppLayout 路由 + 页面骨架

Phase 2 — Role Service (Step 4-5)
  Step 4: roles CRUD (Controller + Service)
  Step 5: GET /api/roles?available_for_review= (G05)

Phase 3 — Review Draft (Step 6-9)
  Step 6: reviews POST + GET + 状态机守卫
  Step 7: POST /diagnose mock + DiagnosisResult JSON schema (G01)
  Step 8: SSE /diagnose/stream (G10)
  Step 9: POST /roles + POST /start

Phase 4 — Knowledge Mock (Step 10-12)
  Step 10: documents POST (mock upload + parse + chunk)
  Step 11: chunks GET + PATCH review-status
  Step 12: POST /search-test mock

Phase 5 — 前端联调 (Step 13-15)
  Step 13: 诊断书页 → SummaryCard + RadarCard + TeamCard
  Step 14: 会议室页 → MeetingHeader + AgentPanel + SpeechFlow
  Step 15: 报告页 → ReportHeader + OpinionTable + ActionTable
```

---

## 6. 缺口覆盖矩阵

| 缺口 | 覆盖方式 | 文件中位置 |
|---|---|---|
| **G01** — DiagnosisResult JSON schema | 定义 `DiagnosisResultJson` TypeScript interface，序列化存 `Review.diagnosis` | `dto/diagnosis-response.dto.ts` |
| **G05** — 可用角色排除已选 | `GET /api/roles?available_for_review={reviewId}` 查询 `review.roleSelection` 并 `id notIn` | `roles.service.ts` |
| **G10** — SSE 诊断流 | `GET /api/reviews/{id}/diagnose/stream` 返回 Observable，Mock 2s 间隔推 4 个进度事件 → complete | `reviews.gateway.ts` |
| **G21** — Auth/me + permissions | `GET /api/auth/me` 返回用户信息 + 从 `platformRole` 派生的权限数组 | `auth.controller.ts` |
| **G22** — camelCase/snake_case | Prisma `@map` 已处理 + NestJS `ClassSerializerInterceptor` + DTO `@Expose()` | 全局配置 |
| **G24** — 错误码映射 | `GlobalExceptionFilter` 统一捕获 Prisma/NestJS 异常 → 业务错误码 | `common/filters/` |

---

## 7. 外部模型调用策略

```
当前: 全 Mock
├─ POST /diagnose: 返回硬编码 DiagnosisResultJson
├─ SSE /diagnose/stream: setInterval 模拟进度
├─ Agent 发言: 返回假 SpeechCardData（Sprint 2 实现）
├─ 报告汇总: 返回假 ReportData（Sprint 2 实现）
└─ 检索: PostgreSQL LIKE 查询，不做 embedding

后续 Sprint:
├─ Sprint 4 (AI/RAG 接入): 替换 mock 为真实模型调用 + pgvector
└─ 所有 mock 保留在 feature flag 后，可随时切回
```

---

## 8. 不做事项清单（Scope Guard）

```
❌ 不改 Prisma schema
❌ 不新增表
❌ 不调用真实模型 API
❌ 不做 MinIO 集成（Mock 用本地文件）
❌ 不做 pgvector 集成
❌ 不做 Worker 进程（Celery 延后）
❌ 不做全量权限校验（只做基本 tenant guard + role 硬编码）
❌ 不做 SSE 断连重连协议（前端自理，G23）
❌ 不做报告页（Sprint 2）
❌ 不做会议室页实时流（Sprint 2）
```
