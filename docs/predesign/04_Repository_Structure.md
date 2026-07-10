# 04. Repository Structure for reasonix

## 1. 推荐仓库策略

MVP 建议采用 monorepo，便于 reasonix 一次性理解全局上下文，并共享类型、Schema、测试工具。

```text
prismreview/
├─ apps/
│  ├─ web/                         # 前端应用
│  ├─ api/                         # API/BFF 服务
│  └─ worker/                      # AI 编排与文档处理 Worker
├─ packages/
│  ├─ shared-types/                # TypeScript 共享类型 / OpenAPI 生成类型
│  ├─ schemas/                     # JSON Schema / Zod / Pydantic schema
│  ├─ prompts/                     # Agent/Chairman 提示词模板
│  ├─ ui/                          # 通用 UI 组件，供 antigravity 落地后沉淀
│  └─ config/                      # eslint/tsconfig/prettier/env config
├─ services/
│  ├─ auth/                        # 认证、租户上下文、RBAC
│  ├─ reviews/                     # 评审生命周期
│  ├─ roles/                       # Agent 角色与版本
│  ├─ knowledge/                   # 文档、Chunk、索引、检索
│  ├─ orchestration/               # 会议状态机与 Agent 调度
│  ├─ reports/                     # 报告生成、导出
│  ├─ actions/                     # Action Items
│  ├─ audit/                       # 审计日志
│  └─ integrations/                # Jira/飞书/Webhook adapter
├─ db/
│  ├─ migrations/
│  ├─ seeds/
│  └─ schema/
├─ tests/
│  ├─ unit/
│  ├─ integration/
│  ├─ e2e/
│  ├─ fixtures/
│  └─ evaluation/                  # AI 输出质量评测集
├─ docs/
│  ├─ architecture/
│  ├─ api/
│  ├─ product/
│  └─ runbooks/
├─ scripts/
├─ .env.example
├─ docker-compose.yml
├─ package.json
└─ README.md
```

## 2. 前端目录

```text
apps/web/src/
├─ app/ or pages/
├─ features/
│  ├─ dashboard/
│  ├─ new-review/
│  ├─ diagnosis/
│  ├─ review-room/
│  ├─ report/
│  ├─ roles/
│  ├─ knowledge/
│  ├─ action-items/
│  └─ admin/
├─ components/
│  ├─ layout/
│  ├─ form/
│  ├─ data-display/
│  ├─ feedback/
│  └─ charts/
├─ lib/
│  ├─ api-client/
│  ├─ auth/
│  ├─ realtime/
│  └─ permissions/
├─ styles/
└─ tests/
```

## 3. API 目录

```text
apps/api/src/
├─ main.ts / main.py
├─ modules/
│  ├─ auth/
│  ├─ tenants/
│  ├─ users/
│  ├─ roles/
│  ├─ knowledge/
│  ├─ reviews/
│  ├─ orchestration/
│  ├─ reports/
│  ├─ actions/
│  ├─ audit/
│  └─ integrations/
├─ common/
│  ├─ guards/
│  ├─ decorators/
│  ├─ errors/
│  ├─ pagination/
│  └─ tenant-context/
└─ openapi/
```

## 4. Worker 目录

```text
apps/worker/src/
├─ jobs/
│  ├─ parse-document.job
│  ├─ embed-document.job
│  ├─ diagnose-review.job
│  ├─ run-agent-turn.job
│  ├─ summarize-report.job
│  └─ export-report.job
├─ orchestration/
│  ├─ state-machine/
│  ├─ meeting-modes/
│  ├─ chairman/
│  └─ confidence/
├─ rag/
│  ├─ loaders/
│  ├─ chunkers/
│  ├─ embeddings/
│  ├─ retrievers/
│  └─ rerankers/
├─ model-providers/
│  ├─ openai/
│  ├─ anthropic/
│  ├─ local/
│  └─ provider.interface
└─ observability/
```

## 5. 命名规范

- 业务实体使用单数：`Review`、`AgentRole`、`KnowledgeDocument`。
- API 路径使用复数：`/reviews`、`/roles`、`/knowledge-documents`。
- 数据库表使用 snake_case 复数：`reviews`、`agent_roles`。
- 事件使用动词过去式：`review_created`、`agent_speaking`。
- 权限使用 `resource.action.scope`：`review.read.owned`。

## 6. reasonix 首轮任务建议

1. 初始化 monorepo 和基础工程。
2. 建立数据库 schema 与 migration。
3. 实现 Auth/Tenant/RBAC 骨架。
4. 实现 Role Service 与预置 5 角色 seed。
5. 实现 Knowledge Document 上传与 mock indexing。
6. 实现 Review 创建、诊断 mock、组局确认。
7. 实现 Round-Robin 状态机与模拟 Agent 输出。
8. 接入真实模型与 RAG。
9. 实现 Report 结构化生成。
10. 补充测试与质量门禁。
