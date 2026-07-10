# 05. Data Model, API & Event Spec

## 1. 核心实体

### Tenant

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 租户 ID |
| name | string | 企业名称 |
| region | enum | cn / global |
| status | enum | active / suspended |
| created_at | timestamp | 创建时间 |

### User

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 用户 ID |
| tenant_id | uuid | 租户 |
| department_id | uuid | 部门 |
| email | string | 邮箱 |
| name | string | 姓名 |
| role | enum | super_admin / enterprise_admin / department_admin / user |
| status | enum | active / disabled |

### AgentRole

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 角色 ID |
| tenant_id | uuid | 租户 |
| department_id | uuid nullable | 所属部门 |
| name | string | 角色名称 |
| code | string | 角色代号 |
| type | enum | preset / custom / marketplace |
| status | enum | enabled / disabled / deleted |
| active_version_id | uuid | 当前版本 |

### AgentRoleVersion

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 版本 ID |
| role_id | uuid | 角色 ID |
| version | int | 版本号 |
| system_prompt | text | 系统提示词 |
| dimensions | jsonb | 审查维度 |
| output_schema | jsonb | 输出结构 |
| knowledge_collection_ids | uuid[] | 挂载知识库 |
| created_by | uuid | 创建者 |
| created_at | timestamp | 创建时间 |

### KnowledgeDocument

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 文档 ID |
| tenant_id | uuid | 租户 |
| scope | enum | global / role / department |
| owner_role_id | uuid nullable | 专属角色 |
| filename | string | 文件名 |
| mime_type | string | 类型 |
| size_bytes | bigint | 大小 |
| storage_uri | string | 对象存储路径 |
| status | enum | uploading / parsing / chunking / indexing / ready / parse_failed / index_failed |

### KnowledgeChunk

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | Chunk ID |
| document_id | uuid | 文档 |
| tenant_id | uuid | 租户 |
| content | text | 文本 |
| metadata | jsonb | 页码、段落、标题等 |
| review_status | enum | pending_review / approved / rejected / deprecated |
| embedding_ref | string | 向量引用 |

### Review

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 评审 ID |
| tenant_id | uuid | 租户 |
| created_by | uuid | 发起人 |
| title | string | 标题 |
| objective | text | 一句话目标 |
| input_type | enum | file / text / both |
| mode | enum | round_robin / free_debate / blind_consensus / red_blue |
| status | enum | draft / diagnosing / ready / running / interrupted / summarizing / completed / failed / archived |
| diagnosis | jsonb | Chairman 诊断书 |
| role_selection | jsonb | 角色与权重 |

### ReviewTurn

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 轮次 ID |
| review_id | uuid | 评审 |
| turn_index | int | 轮次 |
| phase | string | 阶段 |
| role_version_id | uuid | 发言角色版本 |
| status | enum | queued / retrieving / thinking / speaking / completed / timeout / failed / skipped |
| started_at | timestamp | 开始 |
| completed_at | timestamp | 完成 |

### ReviewOpinion

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 意见 ID |
| review_id | uuid | 评审 |
| turn_id | uuid | 轮次 |
| dimension | string | 维度 |
| risk_level | enum | high / medium / low / info |
| issue | text | 问题 |
| recommendation | text | 建议 |
| citations | jsonb | 引用 |
| confidence_score | int | 0-100 |
| feedback | enum nullable | valuable / adopted / false_positive / ignored |

### Report

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 报告 ID |
| review_id | uuid | 评审 |
| status | enum | generating / ready / failed |
| content | jsonb | 六章结构 |
| html_uri | string nullable | HTML 文件 |
| pdf_uri | string nullable | PDF 文件 |
| docx_uri | string nullable | DOCX 文件 |

### ActionItem

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 行动项 ID |
| review_id | uuid | 评审 |
| report_id | uuid | 报告 |
| title | string | 标题 |
| description | text | 描述 |
| owner_id | uuid nullable | 负责人 |
| priority | enum | p0 / p1 / p2 / p3 |
| status | enum | open / assigned / in_progress / blocked / done / canceled |
| due_date | date nullable | 截止日期 |

## 2. API 草案

### Reviews

```http
POST /api/reviews
GET /api/reviews
GET /api/reviews/{reviewId}
POST /api/reviews/{reviewId}/diagnose
POST /api/reviews/{reviewId}/roles
POST /api/reviews/{reviewId}/start
POST /api/reviews/{reviewId}/interrupt
POST /api/reviews/{reviewId}/resume
POST /api/reviews/{reviewId}/summarize
GET /api/reviews/{reviewId}/stream
```

### Roles

```http
GET /api/roles
POST /api/roles
GET /api/roles/{roleId}
POST /api/roles/{roleId}/versions
POST /api/roles/{roleId}/activate-version
POST /api/roles/{roleId}/disable
DELETE /api/roles/{roleId}
```

### Knowledge

```http
GET /api/knowledge/documents
POST /api/knowledge/documents
GET /api/knowledge/documents/{documentId}
POST /api/knowledge/documents/{documentId}/reindex
GET /api/knowledge/documents/{documentId}/chunks
PATCH /api/knowledge/chunks/{chunkId}/review-status
POST /api/knowledge/search-test
```

### Reports & Actions

```http
GET /api/reports/{reportId}
POST /api/reports/{reportId}/export
POST /api/reports/{reportId}/share
POST /api/opinions/{opinionId}/feedback
GET /api/action-items
PATCH /api/action-items/{actionItemId}
POST /api/action-items/{actionItemId}/push
```

## 3. 输出 Schema 示例

### Agent Opinion JSON

```json
{
  "dimension": "技术可行性",
  "risk_level": "high",
  "issue": "当前方案将所有同步调用串联在主链路中，可能放大尾延迟。",
  "evidence_citations": [
    { "chunk_id": "uuid", "document": "架构规范.pdf", "page": 12 }
  ],
  "recommendation": "将非关键路径改为异步事件，并为核心链路设置超时和熔断。",
  "confidence_score": 82,
  "reasoning_summary": "方案描述与历史事故中高耦合同步链路模式相似，且知识库有明确规范引用。"
}
```

## 4. 事件埋点

沿用 PRD 事件，并补充字段规范：

| 事件 | 必填公共字段 |
|---|---|
| 所有事件 | event_id、tenant_id、user_id、timestamp、request_id、session_id |
| review_created | review_id、mode、role_count、quick_mode |
| review_completed | review_id、duration_ms、risk_count、p0_risk_count、report_id |
| agent_speaking | review_id、role_code、turn_index、latency_ms、token_in、token_out、citation_count |
| human_intervention | review_id、turn_index、condition_length、affected_role_count |
| opinion_feedback | review_id、opinion_id、role_code、feedback_type、confidence_score |
| action_item_status_changed | action_item_id、from_status、to_status、operator_id |
| knowledge_entry_published | chunk_id、document_id、source_review_ids、publish_type |

## 5. API 错误码

| Code | HTTP | 说明 |
|---|---:|---|
| AUTH_REQUIRED | 401 | 未登录 |
| FORBIDDEN | 403 | 无权限 |
| TENANT_ISOLATION_VIOLATION | 403 | 跨租户访问 |
| VALIDATION_ERROR | 400 | 参数校验失败 |
| ROLE_IN_USE | 409 | 角色被进行中评审引用 |
| DOCUMENT_PARSE_FAILED | 422 | 文档解析失败 |
| MODEL_TIMEOUT | 504 | 模型调用超时 |
| RATE_LIMITED | 429 | API 频率超限 |
