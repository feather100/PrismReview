# Sprint 1 — 前端交付规格

> 依据：`Component_Specs_and_Design_Tokens.md`（组件规格）
> 后端对齐：`prisma/schema.prisma`（14 表）、`docs/predesign/05_Data_Model_API_Event_Spec.md`（API 草案）
> 日期：2026-07-06
> 目标：工程可落地，不再产生新风格稿

---

## 1. 项目总目录

```
apps/web/src/
├─ app/                          # Next.js App Router
│  ├─ layout.tsx                 # 全局 Layout（Header + Sider + Content）
│  ├─ page.tsx                   # / → Dashboard 工作台
│  ├─ login/
│  │  └─ page.tsx
│  ├─ reviews/
│  │  ├─ new/
│  │  │  └─ page.tsx             # 发起评审
│  │  └─ [reviewId]/
│  │     ├─ page.tsx             # 诊断书
│  │     ├─ meeting/
│  │     │  └─ page.tsx          # 评审会议室
│  │     └─ report/
│  │        └─ page.tsx          # 评审报告
│  └─ (admin)/
│     ├─ roles/page.tsx
│     ├─ knowledge/page.tsx
│     └─ settings/page.tsx
│
├─ components/                    # 全局共享组件
│  ├─ layout/
│  │  ├─ AppHeader.tsx
│  │  ├─ AppSider.tsx
│  │  └─ AppLayout.tsx
│  ├─ common/
│  │  ├─ RiskTag.tsx
│  │  ├─ StatusTag.tsx
│  │  ├─ ConfidenceBadge.tsx
│  │  ├─ EmptyPlaceholder.tsx
│  │  └─ ForbiddenState.tsx
│  └─ state/
│     ├─ LoadingSkeleton.tsx
│     ├─ DisconnectBanner.tsx
│     └─ ErrorAlert.tsx
│
├─ features/                     # 页面级功能模块
│  ├─ diagnosis/                 # 方案诊断书
│  │  ├─ DiagnosisPage.tsx
│  │  ├─ components/
│  │  │  ├─ SummaryCard.tsx
│  │  │  ├─ RadarCard.tsx
│  │  │  ├─ TeamCard.tsx
│  │  │  ├─ AgentCardItem.tsx
│  │  │  └─ RoleSelector.tsx
│  │  └─ hooks/
│  │     └─ useDiagnosis.ts
│  │
│  ├─ meeting/                   # 评审会议室
│  │  ├─ MeetingPage.tsx
│  │  ├─ components/
│  │  │  ├─ MeetingHeader.tsx
│  │  │  ├─ AgentPanel.tsx
│  │  │  ├─ AgentStatusDot.tsx
│  │  │  ├─ SpeechFlow.tsx
│  │  │  ├─ SpeechCard.tsx
│  │  │  ├─ ContextPanel.tsx
│  │  │  └─ InterventionModal.tsx
│  │  └─ hooks/
│  │     ├─ useMeeting.ts
│  │     └─ useRealtime.ts
│  │
│  ├─ report/                    # 评审报告
│  │  ├─ ReportPage.tsx
│  │  ├─ components/
│  │  │  ├─ ReportHeader.tsx
│  │  │  ├─ ExecutiveSummary.tsx
│  │  │  ├─ DimensionChart.tsx
│  │  │  ├─ OpinionTable.tsx
│  │  │  ├─ RiskMatrix.tsx
│  │  │  ├─ RiskCard.tsx
│  │  │  ├─ ActionTable.tsx
│  │  │  └─ LowConfidenceList.tsx
│  │  └─ hooks/
│  │     └─ useReport.ts
│  │
│  └─ dashboard/                 # 工作台
│     ├─ DashboardPage.tsx
│     └─ components/
│        ├─ RecentReviews.tsx
│        └─ MyTodos.tsx
│
├─ lib/                          # 基础设施层
│  ├─ api-client/
│  │  ├─ client.ts               # axios/fetch 封装
│  │  ├─ reviews.api.ts
│  │  ├─ roles.api.ts
│  │  ├─ knowledge.api.ts
│  │  └─ reports.api.ts
│  ├─ auth/
│  │  ├─ AuthProvider.tsx
│  │  └─ useAuth.ts
│  ├─ realtime/
│  │  └─ useSSE.ts               # SSE 连接管理
│  └─ permissions/
│     └─ usePermissions.ts
│
└─ styles/
   └─ theme.ts                   # Ant Design 主题 Token
```

---

## 2. 组件拆分树

### 2.1 方案诊断书页

```
<DiagnosisPage>                              ← Page (Route: /reviews/[reviewId])
 ├─ <PageHeader>                             ← 标题 + 面包屑 + [返回] [确认组局]
 │   └─ title, subtitle, actions
 ├─ (两栏布局 flex)
 │   ├─ Left (60%)
 │   │   ├─ <SummaryCard>                    ← 方案摘要
 │   │   │   └─ summary, tags[]
 │   │   └─ <RadarCard>                      ← 风险雷达图
 │   │       └─ radarDimensions[], confidenceScore
 │   └─ Right (40%)
 │       └─ <TeamCard>                       ← 推荐评审团
 │           ├─ <AgentCardItem>[]            ← 每个推荐 Agent
 │           │   └─ agent, weight, reason, onRemove
 │           └─ <RoleSelector>               ← [添加角色] 按钮 + Modal
 │               └─ availableRoles[], onAdd
 └─ (状态覆盖)
     ├─ <EmptyPlaceholder>                    ← 空态
     ├─ <LoadingSkeleton>                    ← 加载态（骨架屏+Progress）
     ├─ <ErrorAlert> + 手动组局面板           ← 错误态
     └─ <ForbiddenState>                     ← 权限态
```

### 2.2 评审会议室页

```
<MeetingPage>                                ← Page (Route: /reviews/[reviewId]/meeting)
 ├─ <MeetingHeader>                          ← 顶部状态栏
 │   └─ statusTag, title, mode, progress, actions[]
 ├─ (三栏布局 flex)
 │   ├─ Left (20%)
 │   │   └─ <AgentPanel>                     ← Agent 席位面板
 │   │       └─ AgentStatus[] → <AgentStatusDot>
 │   ├─ Center (55%)
 │   │   └─ <SpeechFlow>                     ← 实时发言流
 │   │       └─ SpeechCard[] → <SpeechCard>  ← 每条发言
 │   │           └─ agent, dimension, riskLevel, content, citations[], confidenceScore
 │   └─ Right (25%)
 │       └─ <ContextPanel>                   ← 上下文面板
 │           ├─ 方案摘要
 │           ├─ 知识引用卡片
 │           ├─ 干预条件记录
 │           └─ 操作区: [暂停] [注入新条件] [强制结束]
 ├─ <InterventionModal>                      ← 人机干预弹窗
 │   └─ conditionText, onConfirm, onCancel
 └─ (状态覆盖)
     ├─ <EmptyPlaceholder> + [开始评审]       ← 空态
     ├─ <LoadingSkeleton>                    ← 加载态（三栏骨架）
     ├─ <ErrorAlert> (Agent 超时/失败)        ← 错误态
     ├─ <ForbiddenState>                     ← 权限态
     └─ <DisconnectBanner>                   ← 断连态
```

### 2.3 评审报告页

```
<ReportPage>                                 ← Page (Route: /reviews/[reviewId]/report)
 ├─ <ReportHeader>                           ← 标题 + 评级 + 导出按钮
 │   └─ grade, title, exportActions[]
 ├─ <ExecutiveSummary>                       ← 第一章
 │   └─ grade, summaryText, riskCount, adoptionRate, durationMs
 ├─ <DimensionChart>                         ← 第二章
 │   └─ dimensionScores[]
 ├─ <OpinionTable>                           ← 第三章
 │   └─ opinions[] (dimension | role | riskLevel | content | confidence | citations)
 ├─ <RiskMatrix>                             ← 第四章
 │   └─ matrix[4][4] → <RiskCard>[]
 ├─ <ActionTable>                            ← 第五章
 │   └─ actions[] (priority | title | sourceAgent | owner | status | operations)
 ├─ <LowConfidenceList>                      ← 第六章
 │   └─ lowConfidenceOpinions[] → [确认] [标记误报]
 └─ (状态覆盖)
     ├─ <EmptyPlaceholder>                    ← 空态
     ├─ <LoadingSkeleton>                    ← 加载态（六章骨架）
     ├─ <ErrorAlert>                         ← 错误态
     ├─ <ForbiddenState>                     ← 权限态
     └─ <DisconnectBanner>                   ← 断连态
```

---

## 3. 组件 Props / Data Shape

### 3.1 共享类型（packages/shared-types）

```typescript
// ============================================================
// 通用类型
// ============================================================

/** 风险等级 */
type RiskLevel = 'high' | 'medium' | 'low' | 'info';

/** 信心指数分段 */
type ConfidenceTier = 'high' | 'medium' | 'low'; // 80-100 | 60-79 | 0-59

/** 引用条目 */
interface EvidenceCitation {
  chunkId: string;
  document: string;
  page?: number;
}

/** 用户简要 */
interface UserBrief {
  id: string;
  name: string;
  email: string;
}

// ============================================================
// API 响应包裹
// ============================================================

interface ApiResponse<T> {
  data: T;
  error?: { code: string; message: string };
}

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ============================================================
// 租户 & 权限上下文（AuthProvider 提供）
// ============================================================

interface AuthContext {
  user: UserBrief;
  tenantId: string;
  departmentId: string;
  platformRole: 'super_admin' | 'enterprise_admin' | 'department_admin' | 'user';
  permissions: string[]; // e.g. ['review.create', 'kb.upload']
  can: (action: string, resource?: string) => boolean;
}
```

### 3.2 方案诊断书组件 Props

```typescript
// ============================================================
// 页面数据
// ============================================================

interface DiagnosisPageData {
  review: ReviewBrief;
  diagnosis: DiagnosisResult | null;
}

interface ReviewBrief {
  id: string;
  title: string;
  objective: string;
  status: ReviewStatus;
  mode: ReviewMode;
  inputType: 'file' | 'text' | 'both';
  createdAt: string;
}

// ─── 诊断结果（对应 Review.diagnosis JSON 字段）───

interface DiagnosisResult {
  summary: string;                    // 方案摘要文本
  tags: string[];                     // 领域标签，如 ["架构设计", "微服务", "高并发"]
  radarDimensions: RadarDimension[];  // 雷达图维度数据
  confidenceScore: number;            // 0-100
  recommendedRoles: RecommendedRole[];
}

interface RadarDimension {
  name: string;                       // 如 "性能", "安全", "成本", "可用性", "合规"
  score: number;                      // 0-100
}

interface RecommendedRole {
  roleId: string;
  roleCode: string;                   // "CTO"
  roleName: string;                   // "技术审核员"
  weight: number;                     // 权重百分比，总和=100
  reason: string;                     // 推荐理由
  removable: boolean;                 // 预置角色是否可移除
}

// ============================================================
// 组件 Props
// ============================================================

interface SummaryCardProps {
  summary: string;
  tags: string[];
}

interface RadarCardProps {
  dimensions: RadarDimension[];
  confidenceScore: number;
  /** 雷达图尺寸，默认 280 */
  chartSize?: number;
}

interface TeamCardProps {
  roles: RecommendedRole[];
  onRemoveRole: (roleId: string) => void;
  onAddRole: (roleId: string, weight: number) => void;
  onWeightChange: (roleId: string, newWeight: number) => void;
  /** 权重合计 ≠ 100 时禁止提交 */
  weightError?: string;
}

interface AgentCardItemProps {
  role: RecommendedRole;
  onRemove: () => void;
  onWeightChange: (weight: number) => void;
}

interface RoleSelectorProps {
  availableRoles: AgentRoleBrief[];   // 可选角色列表（后端返回未被选中的）
  onAdd: (roleId: string) => void;
  onCancel: () => void;
  open: boolean;
}

interface AgentRoleBrief {
  id: string;
  code: string;
  name: string;
  description?: string;
}

// ============================================================
// API 调用
// ============================================================

// GET  /api/reviews/{reviewId}/diagnosis → DiagnosisResult | null
// POST /api/reviews/{reviewId}/diagnose  → { taskId: string }  // 触发异步诊断
// GET  /api/reviews/{reviewId}/diagnose/status → { status: 'running'|'completed'|'failed', progress: number }
// POST /api/reviews/{reviewId}/roles     → { roleSelection: RecommendedRole[] }
// POST /api/reviews/{reviewId}/start     → { sessionId: string }

// ─── 诊断 SSE 流（/api/reviews/{reviewId}/diagnose/stream）───
// event: progress   data: { percent: 65, stage: "正在分析方案领域标签..." }
// event: complete   data: { diagnosis: DiagnosisResult }
// event: error      data: { message: "..." }
```

### 3.3 评审会议室组件 Props

```typescript
// ============================================================
// 页面数据
// ============================================================

interface MeetingPageData {
  review: ReviewBrief;
  session: MeetingSession;
}

interface MeetingSession {
  id: string;
  status: MeetingStatus;
  mode: ReviewMode;
  progress: {
    completed: number;
    total: number;
  };
  agents: AgentStatus[];
  speechCards: SpeechCardData[];
  context: MeetingContext;
}

type MeetingStatus =
  | 'connecting'
  | 'running'
  | 'interrupted'
  | 'summarizing'
  | 'completed'
  | 'failed';

interface AgentStatus {
  roleId: string;
  roleCode: string;
  roleName: string;
  turnId?: string;
  status: AgentTurnStatus;
  /** 发言次数 */
  speechCount: number;
  /** 本次发言已用时 (ms)，仅 speaking 态时有效 */
  elapsedMs?: number;
}

interface SpeechCardData {
  id: string;
  turnId: string;
  agentCode: string;
  agentName: string;
  dimension: string;
  riskLevel: RiskLevel;
  issue: string;
  recommendation: string;
  citations: EvidenceCitation[];
  confidenceScore: number;
  reasoningSummary?: string;
  /** 发言时间 */
  timestamp: string;
  /** 是否断连后补发 */
  isRetrofill?: boolean;
}

interface MeetingContext {
  summary: string;
  conditions: InterventionRecord[];
  /** 当前引用知识 */
  currentCitations?: EvidenceCitation[];
}

interface InterventionRecord {
  id: string;
  condition: string;
  createdAt: string;
  affectedRoles: string[];
}

// ============================================================
// 组件 Props
// ============================================================

interface MeetingHeaderProps {
  status: MeetingStatus;
  title: string;
  mode: ReviewMode;
  progress: { completed: number; total: number };
  onInterrupt: () => void;
  onPause: () => void;
  onForceEnd: () => void;
  /** 打断/暂停/结束 是否可用 */
  canInterrupt: boolean;
  canPause: boolean;
  canForceEnd: boolean;
}

interface AgentPanelProps {
  agents: AgentStatus[];
}

interface AgentStatusDotProps {
  status: AgentTurnStatus;
  /** 脉冲动画（speaking 态） */
  animate?: boolean;
}

interface SpeechFlowProps {
  cards: SpeechCardData[];
  /** 是否正在加载历史消息 */
  loading?: boolean;
  /** 是否自动滚到底部 */
  autoScroll?: boolean;
}

interface SpeechCardProps {
  data: SpeechCardData;
  /** 是否显示完整内容，默认折叠长文 */
  expanded?: boolean;
  onToggleExpand?: () => void;
  onCiteClick?: (citation: EvidenceCitation) => void;
}

interface ContextPanelProps {
  context: MeetingContext;
  onInjectCondition: () => void;
  onPause: () => void;
  onForceEnd: () => void;
  /** 操作按钮是否可用 */
  canIntervene: boolean;
  canPause: boolean;
  canForceEnd: boolean;
}

interface InterventionModalProps {
  open: boolean;
  onConfirm: (condition: string) => void;
  onCancel: () => void;
  submitting?: boolean;
}

// ============================================================
// API / 实时通道
// ============================================================

// ─── SSE 流（GET /api/reviews/{reviewId}/stream）───
// event: agent_status    data: { turnId, roleCode, status, elapsedMs }
// event: speech          data: { SpeechCardData }
// event: progress        data: { completed, total }
// event: intervention    data: { condition, affectedRoles }
// event: meeting_end     data: { reason: 'completed'|'failed'|'manual' }

// ─── REST ───
// POST /api/reviews/{reviewId}/start     → { sessionId }     ← 开始评审
// POST /api/reviews/{reviewId}/interrupt → { sessionId }     ← 举手打断
// POST /api/reviews/{reviewId}/resume    → { sessionId }     ← 恢复
// POST /api/reviews/{reviewId}/summarize → { taskId }        ← 强制结束并汇总
// POST /api/reviews/{reviewId}/condition → { condition }     ← 注入新条件
```

### 3.4 评审报告页组件 Props

```typescript
// ============================================================
// 页面数据
// ============================================================

interface ReportPageData {
  review: ReviewBrief;
  report: ReportData | null;
}

interface ReportData {
  id: string;
  status: ReportStatus;
  grade: ReportGrade;
  executiveSummary: ExecutiveSummaryData;
  dimensionScores: DimensionScoreData[];
  opinions: OpinionTableRow[];
  riskMatrix: RiskMatrixData;
  actions: ActionItemData[];
  lowConfidenceOpinions: LowConfidenceOpinionData[];
  /** 缺失 Agent 列表 */
  incompleteAgents?: AgentFailureInfo[];
}

type ReportGrade = 'approved' | 'conditionally_approved' | 'rejected';
type ReportStatus = 'generating' | 'ready' | 'failed' | 'human_review_required';

interface ExecutiveSummaryData {
  grade: ReportGrade;
  summaryText: string;
  riskCount: number;
  p0RiskCount: number;
  adoptionRate: number;         // 建议采纳率百分比
  totalDurationMs: number;
}

interface DimensionScoreData {
  dimension: string;
  score: number;                // 0-10
  agentCount: number;
}

interface OpinionTableRow {
  id: string;
  dimension: string;
  agentCode: string;
  agentName: string;
  riskLevel: RiskLevel;
  issue: string;
  recommendation: string;
  confidenceScore: number;
  citations: EvidenceCitation[];
  feedback?: 'valuable' | 'adopted' | 'false_positive' | 'ignored';
}

interface RiskMatrixData {
  /** 2x2 矩阵: [影响][概率] */
  cells: RiskMatrixCell[][];
}

interface RiskMatrixCell {
  x: 'low' | 'high';            // 影响
  y: 'low' | 'high';            // 概率
  risks: RiskCardData[];
}

interface RiskCardData {
  id: string;
  title: string;
  riskLevel: RiskLevel;
  sourceAgent: string;
  description: string;
}

interface ActionItemData {
  id: string;
  title: string;
  description?: string;
  priority: 'p0' | 'p1' | 'p2' | 'p3';
  sourceAgent: string;
  owner?: UserBrief;
  status: ActionItemStatus;
  dueDate?: string;
  /** 外部推送状态：null=未配置, 'mock'=Mock, 'connected'=已连接 */
  pushStatus?: null | 'mock' | 'connected';
}

interface LowConfidenceOpinionData {
  id: string;
  opinionId: string;
  agentCode: string;
  agentName: string;
  issue: string;
  confidenceScore: number;
  reasoningSummary?: string;
  /** 人工确认状态 */
  reviewStatus?: 'pending' | 'confirmed' | 'false_positive';
}

interface AgentFailureInfo {
  agentCode: string;
  agentName: string;
  reason: 'timeout' | 'failed' | 'skipped';
}

// ============================================================
// 组件 Props
// ============================================================

interface ReportHeaderProps {
  grade: ReportGrade;
  title: string;
  onExport: (format: 'md' | 'html') => void;
  /** 导出是否可用（断连态=false） */
  exportEnabled?: boolean;
  incompleteAgents?: AgentFailureInfo[];
}

interface ExecutiveSummaryProps {
  data: ExecutiveSummaryData;
}

interface DimensionChartProps {
  dimensions: DimensionScoreData[];
}

interface OpinionTableProps {
  opinions: OpinionTableRow[];
  onFeedback?: (opinionId: string, feedback: string) => void;
}

interface RiskMatrixProps {
  data: RiskMatrixData;
}

interface RiskCardProps {
  risk: RiskCardData;
}

interface ActionTableProps {
  actions: ActionItemData[];
  onStatusChange?: (id: string, status: ActionItemStatus) => void;
  /** 推送是否为 Mock */
  pushMock?: boolean;
}

interface LowConfidenceListProps {
  opinions: LowConfidenceOpinionData[];
  onConfirm: (opinionId: string) => void;
  onMarkFalsePositive: (opinionId: string) => void;
}

// ============================================================
// API 调用
// ============================================================

// GET /api/reports/{reportId}   → ReportData
// POST /api/reports/{reportId}/export?format=md|html → { downloadUri }
// POST /api/opinions/{opinionId}/feedback → { opinionId, feedback }
// PATCH /api/action-items/{id}  → ActionItemData
```

---

## 4. 字段映射缺口

### 4.1 诊断书 — 字段缺口清单

| # | 前端需要 | 后端状态 | 缺口说明 | 建议修复 |
|---|---|---|---|---|
| G01 | `DiagnosisResult.radarDimensions[]` | `Review.diagnosis` 为 `Json?` — 无子结构定义 | DB 字段是无结构的 JSON，前后端未约定内部 schema | 定义 `DiagnosisResultJson` 类型并由 API 层序列化/反序列化 |
| G02 | `RecommendedRole.reason` | `review.role_selection` 为 `Json?` — 无推荐理由字段 | 当前只有角色 ID+权重，缺少"推荐理由" | 在 `roleSelection` JSON 中增加 `reason: string` 字段 |
| G03 | `RecommendedRole.removable` | 无此概念 | 预置角色和自定义角色是否可移除不同 | API 层根据 `role.type` 计算：`type=preset` → `removable=false` |
| G04 | 诊断进度 SSE 流 | 无 SSE endpoint 定义 | 只有 `POST /diagnose` 和 `GET /status` polling | 新增 `GET /api/reviews/{id}/diagnose/stream` SSE endpoint |
| G05 | `RoleSelectorProps.availableRoles` | 无排除已选角色的独立 API | 前端需要"可用角色列表 = 全部 − 已选" | API 返回 `availableRoles` 或在 `GET /roles` 传 `excludeIds` 参数 |

### 4.2 评审会议室 — 字段缺口清单

| # | 前端需要 | 后端状态 | 缺口说明 | 建议修复 |
|---|---|---|---|---|
| G06 | `SpeechCardData.agentName` | `ReviewTurn.roleVersionId` 是 UUID，无关联角色信息 | 前端的每次发言需要角色名/代号/头像，当前只有一个 FK | API 层 JOIN `agent_role_versions` → `agent_roles`，返回 `agentCode` + `agentName` |
| G07 | `AgentStatus.speechCount` | 无预计算字段 | AgentPanel 需要展示"发言次数" | API 层 `COUNT(opinions) GROUP BY roleVersionId` 聚合 |
| G08 | `SpeechCardData.isRetrofill` | 无此概念 | 断连补发需要标记 | SSE 事件增加 `retrofill: boolean` 字段 |
| G09 | `MeetingContext.conditions[]` | `Review` 无干预记录字段 | 人机干预的记录需要独立存储 | 新增 `review_interventions` 表或作为 `Review` 的 JSON 字段 |
| G10 | SSE 流事件协议 | 未定义 | 前端需要标准事件名和 data 结构 | 按上节定义实现 SSE 协议（event: `agent_status`, `speech`, `progress`, `intervention`, `meeting_end`） |
| G11 | `InterventionModal.condition` 注入后影响范围 | 无此设计 | 注入条件时需要返回"影响了哪些 Agent" | `POST /condition` 返回 `{ affectedRoles: string[] }` |
| G12 | 发言卡片折叠/展开 | 纯 UI 态 | 长文本需要折叠，但设计中提及 | 前端自行计算字符数 > 300 时默认折叠 |

### 4.3 评审报告 — 字段缺口清单

| # | 前端需要 | 后端状态 | 缺口说明 | 建议修复 |
|---|---|---|---|---|
| G13 | `ReportData.grade` | `Report.content` 为 `Json?` — 无 `grade` 顶层字段 | 评级 "通过/有条件/不通过" 展示在 Header，当前无结构化字段 | 在 `Report` 表加 `grade` 字段，或约定在 `content` JSON 的顶层 |
| G14 | `ExecutiveSummaryData.adoptionRate` | 无此数据 | 采纳率需要从 `review_opinions.feedback` 计算 | API 层计算 `COUNT(feedback='adopted') / COUNT(total)` |
| G15 | `ExecutiveSummaryData.totalDurationMs` | 无此字段 | 需要从 `review_turns.completedAt - review.createdAt` 计算 | API 层计算或加物化字段 |
| G16 | `DimensionScoreData.score` | 无评分聚合 | 各维度评分是多个 Agent 意见的综合结果 | API 层按 `dimension` 聚合 `confidenceScore` 取均值 |
| G17 | `RiskMatrixData` 2x2 结构 | `review_opinions` 无影响/概率枚举 | 风险矩阵需要"影响×概率"两个轴，当前只有 `riskLevel` | 在 `review_opinions` 加 `impact` + `likelihood` 字段，或从 `riskLevel` 映射 |
| G18 | `ActionItemData.pushStatus` | `ActionItem` 无推送状态 | "推送外部"按钮需要显示 Mock/未配置 | 在 `ActionItem` 加 `integration_status` 字段 |
| G19 | `LowConfidenceOpinionData.reviewStatus` | `ReviewOpinion.feedback` 有值但语义不同 | `feedback` 是"有价值/误报"的反馈，`reviewStatus` 是"已人工确认/待确认"的状态 | 新增 `confirmed_at` 时间戳字段，null=待确认 |
| G20 | `ReportData.incompleteAgents` | 无聚合 | 报告 Head 需要展示哪些 Agent 失败/超时 | API 层找出 status=timeout/failed/skipped 的 ReviewTurn → 聚合 |

### 4.4 跨页面系统缺口

| # | 前端需要 | 后端状态 | 缺口说明 | 建议修复 |
|---|---|---|---|---|
| G21 | `AuthContext.permissions[]` | 无权限检查 API | 前端无法知道当前用户能否执行操作（如开始评审） | `GET /api/auth/me` 返回用户信息 + `permissions: string[]` |
| G22 | snake_case ↔ camelCase | API 返回 snake_case | 前端 TypeScript 用 camelCase | API 层统一用 camelCase（NestJS `@SerializeOptions`）或前端加 transform |
| G23 | `DisconnectBanner` 自动重连状态 | 无此协议 | 前端需要知道重连状态和次数 | SSE 连接自身管理，不用后端参与 |
| G24 | 错误码映射 | API 草案定义了错误码 | 前端需要统一错误处理 | 前端 API client 实现 error interceptor，将 `FORBIDDEN` → 权限态，`MODEL_TIMEOUT` → 错误态 |

### 4.5 紧急程度分类

```
P0 — 阻塞 MVP 实现（缺少则页面不可用）：
  G01, G05, G10, G13, G17, G21, G22, G24

P1 — 功能降级可接受（缺少则体验下降但可用）：
  G02, G06, G07, G09, G14, G15, G16, G20

P2 — MVP 可 Mock（缺少则用前端假数据占位）：
  G03, G04, G08, G11, G12, G18, G19, G23
```

---

## 5. 各 Page 的 API 依赖 DAG

### 5.1 诊断书页

```
[进入页面]
  │
  ├── GET /api/auth/me                    ← 检查权限
  ├── GET /api/reviews/{id}               ← ReviewBrief
  │
  ├── [诊断书存在?]
  │   ├── 是: GET /api/reviews/{id}/diagnosis   → DiagnosisResult
  │   │   └── 同步 GET /api/roles?available=true  → AgentRoleBrief[]
  │   │
  │   └── 否: [空态 → 引导去发起评审]
  │
  ├── [用户点击生成诊断书]
  │   ├── POST /api/reviews/{id}/diagnose   → { taskId }
  │   ├── SSE   /api/reviews/{id}/diagnose/stream → 进度事件
  │   └── 完成 → 重新 GET /diagnosis
  │
  └── [用户点击确认组局]
      ├── POST /api/reviews/{id}/roles   → { roleSelection }
      └── POST /api/reviews/{id}/start   → { sessionId }
          └── 跳转 /reviews/{id}/meeting
```

### 5.2 评审会议室页

```
[进入页面]
  │
  ├── GET /api/auth/me                    ← 检查权限
  ├── GET /api/reviews/{id}               ← ReviewBrief + 状态
  │
  ├── [状态 = draft/ready]
  │   └── [空态: 显示评审概要 + 开始按钮]
  │
  ├── [状态 = running]
  │   ├── GET /api/reviews/{id}/meeting/session
  │   │   → 历史发言 + Agent 状态 + 上下文
  │   └── SSE /api/reviews/{id}/stream
  │       ├── event: agent_status   → AgentPanel 更新
  │       ├── event: speech         → SpeechFlow 追加
  │       ├── event: progress       → MeetingHeader 更新
  │       ├── event: intervention   → ContextPanel 更新
  │       └── event: meeting_end    → 跳转报告页
  │
  ├── [用户操作]
  │   ├── POST /api/reviews/{id}/interrupt  → 暂停
  │   ├── POST /api/reviews/{id}/condition  → 注入条件
  │   ├── POST /api/reviews/{id}/resume     → 恢复
  │   └── POST /api/reviews/{id}/summarize  → 强制结束
  │
  └── [断连重连]
      ├── SSE 自动重连 (5次指数退避)
      └── SSE 恢复后收到 retrofill 事件
```

### 5.3 评审报告页

```
[进入页面]
  │
  ├── GET /api/auth/me                    ← 检查权限
  ├── GET /api/reviews/{id}               ← ReviewBrief + status
  │
  ├── [status ≠ completed]
  │   └── [空态: 信息提示 + 返回会议室按钮]
  │
  ├── [status = completed]
  │   └── GET /api/reports/by-review/{reviewId}  → ReportData
  │       ├── 报告 ready       → 六章渲染
  │       ├── 报告 generating  → [加载态骨架屏 + 轮询/Polling]
  │       └── 报告 failed      → [错误态 + 重新生成按钮]
  │
  ├── [用户操作]
  │   ├── POST /api/reports/{id}/export?format=md  → 下载
  │   ├── POST /api/opinions/{id}/feedback          → 反馈
  │   ├── PATCH /api/action-items/{id}              → 更新状态
  │   └── POST /api/opinions/{id}/confirm           → 确认低信心意见
  │
  └── [断连]
      └── 已加载内容保持可读，导出按钮禁用
```

---

## 6. Ant Design 主题配置

```typescript
// apps/web/src/styles/theme.ts
import type { ThemeConfig } from 'antd';

export const prismTheme: ThemeConfig = {
  token: {
    colorPrimary: '#4F46E5',           // Indigo-600
    colorSuccess: '#16A34A',           // Green-600
    colorWarning: '#D97706',           // Amber-600
    colorError: '#DC2626',             // Red-600
    colorInfo: '#2563EB',              // Blue-600
    colorBgLayout: '#F3F4F6',         // Gray-100
    colorBgContainer: '#FFFFFF',
    colorBorder: '#E5E7EB',           // Gray-200
    colorText: '#111827',             // Gray-900
    colorTextSecondary: '#4B5563',    // Gray-600
    colorTextTertiary: '#9CA3AF',     // Gray-400
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
    borderRadius: 6,
    fontSize: 14,
    controlHeight: 32,
    controlHeightLG: 40,
    padding: 16,
    paddingLG: 24,
    paddingXS: 8,
    margin: 16,
    marginLG: 24,
    marginXS: 8,
    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
    boxShadowSecondary: '0 4px 6px -1px rgba(0,0,0,0.08)',
  },
  components: {
    Card: {
      padding: 16,
      paddingLG: 24,
      borderRadius: 8,
      boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
      boxShadowHover: '0 4px 6px -1px rgba(0,0,0,0.08)',
    },
    Tag: {
      fontSize: 12,
      lineHeight: '22px',
      borderRadius: 4,
    },
    Table: {
      headerBg: '#F9FAFB',
      headerColor: '#4B5563',
      rowHoverBg: '#EEF2FF',
      borderRadius: 6,
      cellPaddingBlock: 12,
      cellPaddingInline: 16,
    },
    Button: {
      borderRadius: 6,
      controlHeight: 32,
      controlHeightLG: 40,
    },
    Layout: {
      headerBg: '#FFFFFF',
      headerHeight: 56,
      siderBg: '#FFFFFF',
      bodyBg: '#F3F4F6',
    },
    Progress: {
      circleTextFontSize: 24,
    },
    Alert: {
      borderRadius: 8,
    },
  },
};
```

---

## 7. 实现优先级（MVP 🏗️）

```
Sprint 1 — 基础设施
  └─ AppLayout (Header + Sider + Content)
  └─ theme.ts Ant Design 主题配置
  └─ API client 封装 + error interceptor
  └─ AuthProvider + useAuth

Sprint 1 — 方案诊断书
  └─ SummaryCard + RadarCard + TeamCard
  └─ AgentCardItem + RoleSelector
  └─ 加载/错误/权限/断连态

Sprint 2 — 评审会议室
  └─ MeetingHeader + AgentPanel + SpeechFlow
  └─ SpeechCard + ContextPanel
  └─ SSE 连接管理 (useRealtime)
  └─ 人机干预 Modal
  └─ 所有 5 态覆盖

Sprint 2 — 评审报告
  └─ ReportHeader + ExecutiveSummary
  └─ OpinionTable + ActionTable
  └─ RiskMatrix + LowConfidenceList
  └─ 导出按钮 + 反馈按钮
  └─ 所有 5 态覆盖
```

---

## 附录 A：Ant Design → 实际组件映射速查

| 规格文档组件 | Ant Design 组件 | 自定义程度 |
|---|---|---|
| `EmptyPlaceholder` | `<Empty>` | 0 — 直接使用 |
| `LoadingSkeleton` | `<Skeleton>`, `<Skeleton.Node>` | 0 — 直接使用 |
| `ErrorAlert` | `<Alert type="error">` | + 图标 + 重试按钮 |
| `ForbiddenState` | `<Result status="403">` | 0 — 直接使用 |
| `DisconnectBanner` | `<Alert type="warning" banner>` | + 重连进度文字 |
| `RiskTag` | `<Tag color="red\|orange\|gold">` | + 风险级别映射 |
| `StatusTag` | `<Tag>` | + color mapping |
| `ConfidenceBadge` | `<Badge>` | + color/size mapping |
| `SummaryCard` | `<Card><Descriptions>` | 组合使用 |
| `RadarCard` | `<Card>` + ECharts | 自定义 |
| `TeamCard` | `<Card><List>` | 组合使用 |
| `AgentCardItem` | `<Card.Grid>` | 组合使用 |
| `RoleSelector` | `<Select><Modal>` | 组合使用 |
| `MeetingHeader` | `<Flex><Tag><Typography>` | 完全自定义 |
| `AgentPanel` | `<Card><List>` | 组合使用 |
| `SpeechFlow` | `<List>` | 自定义虚拟滚动 |
| `SpeechCard` | `<Card>` | 完全自定义 |
| `ContextPanel` | `<Card>` | 完全自定义 |
| `InterventionModal` | `<Modal><Form.TextArea>` | 组合使用 |
| `ReportHeader` | `<Flex><Badge><Dropdown>` | 组合使用 |
| `OpinionTable` | `<Table>` | 0 — 直接使用 |
| `ActionTable` | `<Table>` | 0 — 直接使用 |
| `RiskMatrix` | CSS Grid | 完全自定义 |
| `LowConfidenceList` | `<List>` | 组合使用 |
