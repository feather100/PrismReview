# PrismReview Sprint 0.5 Implementation Plan

本计划概述了接下来的三个核心模块的后端和数据层实现方案：Role Service (角色服务)、Review Draft (评审草稿管理)、Knowledge Mock Upload (知识库模拟上传)。

## User Review Required

> [!IMPORTANT]
> 1. **Prisma Schema 扩充**: 请确认以下建议的实体结构是否符合 14 张表的整体规划。
> 2. **Mock 边界**: Knowledge Mock Upload 是否仅模拟到“返回成功状态并写入一条虚拟 Document 记录”，而不实际进行本地文本切割？

## Proposed Changes

### 1. 角色服务 (Role Service)

**目标**：管理预置的 5 个角色（架构师、产品、安全、PMO、QA）以及后续的自定义角色，支持通过 API 获取组局可选角色列表。

- **Schema (Prisma)**:
  - 增加/更新 `AgentRole` 表：
    ```prisma
    model AgentRole {
      id             String   @id @default(uuid())
      name           String   // 例如: Technical Architect
      description    String
      systemPrompt   String   // 角色的核心人设指令
      defaultWeight  Float    // 默认发言权重
      isCustom       Boolean  @default(false)
      tenantId       String   // 多租户隔离 (预置角色可设为 "system")
      createdAt      DateTime @default(now())
      updatedAt      DateTime @updatedAt
    }
    ```
- **API 接口 (apps/api)**:
  - `GET /api/roles` (获取当前租户及系统预置角色列表)
  - `POST /api/roles` (创建自定义角色)
  - `GET /api/roles/:id` (获取角色详情)

### 2. 评审草稿 (Review Draft)

**目标**：支撑用户在发起评审时的页面状态流转（创建草稿 -> 填写目标 -> 等待诊断 -> 确认组局）。

- **Schema (Prisma)**:
  - 增加/更新 `Review` 表及 `ReviewRole` 关联表：
    ```prisma
    enum ReviewStatus {
      DRAFT
      DIAGNOSING
      READY
      RUNNING
      COMPLETED
    }

    model Review {
      id          String       @id @default(uuid())
      objective   String?
      status      ReviewStatus @default(DRAFT)
      tenantId    String
      createdAt   DateTime     @default(now())
      updatedAt   DateTime     @updatedAt
      roles       ReviewRole[] // 选择的评审委员会成员
    }

    model ReviewRole {
      reviewId    String
      roleId      String
      weight      Float
      @@id([reviewId, roleId])
    }
    ```
- **API 接口 (apps/api)**:
  - `POST /api/reviews` (创建一个处于 DRAFT 状态的空评审)
  - `PATCH /api/reviews/:id` (更新 objective 和 status)
  - `POST /api/reviews/:id/roles` (提交最终确认的角色组局列表)

### 3. 知识库模拟上传 (Knowledge Mock Upload)

**目标**：实现一个 Mock API，允许前端完成“文档上传 -> 解析 -> 返回成功”的闭环，为后续 RAG Spike 和 UI 联调提供支撑。

- **Schema (Prisma)**:
  - 增加 `Document` 和 `DocumentChunk` 表：
    ```prisma
    model Document {
      id          String   @id @default(uuid())
      filename    String
      status      String   @default("uploaded") // uploaded, parsing, ready
      tenantId    String
      createdAt   DateTime @default(now())
    }
    ```
- **API 接口 (apps/api)**:
  - `POST /api/knowledge/upload`
    - 逻辑：接收 Multipart 文件，不调用真实的 OCR 或向量化服务。
    - 动作：在数据库插入一条 `Document` 记录，将其状态立即（或通过定时器）标记为 `ready`。
    - 返回：Document ID 与 Mock 解析进度。

## Verification Plan

### Automated Tests
- 为 `Role Service` 编写基础 CRUD 的集成测试。
- 测试 `Review Draft` 的状态机流转。

### Manual Verification
- 通过 Postman / curl 手动请求 `POST /api/knowledge/upload`，验证是否能成功写入 Document 表并返回 Mock 结果。
