# 03. Technical Architecture

## 1. 架构目标

- 支撑多租户企业级隔离。
- 支撑多 Agent 长任务编排与流式输出。
- 支撑 RAG 文档处理、向量检索和可追溯引用。
- 支撑审计、权限、事件埋点和后续外部集成。
- 保持模型供应商、向量库、对象存储可替换。

## 2. 推荐技术栈

| 层 | 推荐 | 说明 |
|---|---|---|
| Web | Next.js / React / TypeScript | 适合复杂交互、SSR 可选 |
| API | Node.js NestJS 或 Python FastAPI | 若 AI 编排重，FastAPI 更自然；若全栈 TS，NestJS 更统一 |
| Agent Worker | Python | LangGraph/CrewAI/自研状态机均可 |
| Queue | Redis + BullMQ / Celery | 长任务、重试、超时 |
| DB | PostgreSQL | 事务、权限、审计、JSONB |
| Vector DB | pgvector / Qdrant / Milvus | MVP 可选 pgvector，后续可迁移 |
| Object Storage | S3 compatible / MinIO | 原始文档、报告文件 |
| Search | PostgreSQL FTS / OpenSearch | 历史评审关键词检索 |
| Realtime | WebSocket / SSE | 会议流式输出 |
| Auth | OIDC/SAML ready | MVP 可账号密码 + OIDC 抽象 |
| Observability | OpenTelemetry + Prometheus/Grafana | Trace Agent/RAG/模型耗时 |

## 3. 服务拆分

```text
Frontend Web
  ↓ REST/SSE/WebSocket
API Gateway / BFF
  ├─ Auth & Tenant Service
  ├─ Review Service
  ├─ Role Service
  ├─ Knowledge Service
  ├─ Report Service
  ├─ Action Item Service
  ├─ Admin Service
  └─ Event/Audit Service
        ↓ queue
Worker Layer
  ├─ Document Pipeline Worker
  ├─ Embedding Worker
  ├─ Agent Orchestration Worker
  ├─ Report Generation Worker
  └─ Integration Worker
        ↓
PostgreSQL / Vector DB / Object Storage / Model Provider
```

## 4. 核心数据流

### 4.1 发起评审

1. Web 上传文件或提交文本。
2. API 创建 Review draft，文档进入 Object Storage。
3. 文档解析 Worker 提取文本。
4. Chairman 预扫描生成 diagnosis。
5. 用户确认角色和权重。
6. Review 状态进入 running，编排 Worker 执行会议。
7. Agent 输出通过 SSE/WebSocket 推送到前端。
8. 会议结束后 Report Worker 汇总报告。
9. 事件和审计写入 Event/Audit。

### 4.2 RAG 检索

1. Agent 根据角色、评审目标、当前轮次生成检索 query。
2. Knowledge Service 校验 tenant/role/document 权限。
3. Vector DB 返回 Top-K chunks。
4. reranker 可选重排。
5. Agent prompt 注入引用片段和元数据。
6. 输出意见必须带 citation ids。

## 5. 多租户设计

- 所有业务表包含 `tenant_id`。
- API 层从认证 token 注入 tenant context。
- DB 查询必须通过 repository scope 自动附加 `tenant_id`。
- 对象存储路径包含租户前缀：`tenants/{tenant_id}/...`。
- 向量库 metadata 包含 `tenant_id`、`visibility_scope`、`role_id`。
- 审计日志记录跨租户访问尝试。

## 6. 权限设计

RBAC + Scope：

- Role：super_admin、enterprise_admin、department_admin、user。
- Scope：tenant、department、owned、shared。
- Permission 示例：`role.read`、`role.write`、`kb.upload`、`review.create`、`review.read.all`、`audit.read`。

建议实现统一授权函数：

```text
can(user, action, resource) -> allow/deny + reason
```

## 7. AI 编排设计

- Agent Orchestration Worker 采用状态机。
- 每次 Agent 发言是一个可重试任务。
- 每个任务记录：prompt hash、model、temperature、retrieved chunks、output schema validation、token usage、latency。
- 输出必须通过 JSON Schema 校验，不通过则进行一次 repair。
- 会议设置全局 timeout、单 Agent timeout、最大轮次。

## 8. 白盒审计

每条意见保存：

- `opinion_id`
- `agent_role_version_id`
- `review_turn_id`
- `risk_level`
- `dimension`
- `claim`
- `evidence_citations[]`
- `recommendation`
- `confidence_score`
- `reasoning_summary`
- `raw_model_output_ref`

注意：不建议向最终用户展示完整隐藏推理链；展示可审计的“理由摘要 + 引用 + 输入输出轨迹”。

## 9. 安全要求

- TLS 1.2+。
- 文档和报告静态加密。
- 敏感字段可列级加密。
- 所有下载链接使用短期签名 URL。
- 文档解析沙箱化，防止恶意文件。
- 模型调用前执行脱敏策略，可配置是否允许外部模型。
- 审计日志不可被普通管理员删除。

## 10. 可观测性

关键指标：

- Chairman diagnosis latency。
- Agent task latency / timeout rate。
- RAG recall click/feedback rate。
- report generation latency。
- model token cost。
- queue depth。
- SSE/WebSocket disconnect rate。
- API 403 cross-tenant attempts。

## 11. 部署形态

MVP 推荐单体模块化 + Worker：

```text
web-app
api-service
worker-service
postgres
redis
object-storage
vector-db 或 pgvector
```

后续当并发和团队规模增长，再拆成独立微服务。
