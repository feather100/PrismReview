# Sprint 1 — Frontend Delivery Plan (UI/UX 侧交付)

基于 `Frontend_Delivery_Spec.md`，以下是前端交付的四个核心部分：组件 props 最小字段、页面状态说明、Mock 数据样例以及针对后端接口缺口的 UI 降级方案。

---

## 1. 组件 Props 最小字段 (Minimum Props)

在剔除当前后端暂不支持的复杂特性后，核心组件的最小必要属性（Minimum Viable Props）定义如下：

### 1.1 方案诊断书 (Diagnosis)
```typescript
interface MinSummaryCardProps {
  summary: string;
  tags: string[]; // 如果后端无结构化，则前端展示空数组或全量 fallback
}

interface MinTeamCardProps {
  roles: { roleId: string; roleName: string; weight: number }[];
  onRemoveRole: (roleId: string) => void;
  // 暂时隐藏 removable 和 reason
}
```

### 1.2 评审会议室 (Meeting)
```typescript
interface MinSpeechCardProps {
  id: string;
  agentName: string; 
  dimension: string;
  content: string; // 将 recommendation 和 issue 合并展示
  riskLevel: 'high' | 'medium' | 'low' | 'info';
  // 暂时隐藏 citations 和 confidenceScore
}

interface MinAgentPanelProps {
  agents: { roleName: string; status: 'waiting' | 'speaking' | 'done' }[];
  // 暂时隐藏 speechCount 和 elapsedMs
}
```

### 1.3 评审报告 (Report)
```typescript
interface MinReportHeaderProps {
  title: string;
  // 暂时隐藏 grade (由前端算或不展示)
}

interface MinActionTableProps {
  actions: { title: string; sourceAgent: string; status: string }[];
  // 暂时隐藏 pushStatus, priority, owner
}
```

---

## 2. 页面状态稿 (Page States)

为了应对长耗时和网络不稳定，页面必须涵盖以下状态处理：

### 2.1 骨架屏加载态 (Loading Skeleton)
- **触发时机**：初始进入页面 `GET /api/reviews/{id}` 等待时。
- **UI 呈现**：
  - **诊断书**：左右两栏灰色区块闪烁，左侧圆圈代表雷达图。
  - **会议室**：三栏结构骨架，中间展示交错的横条形占位符。
  - **报告页**：长列表骨架屏，顶部展示大块矩形（图表位）。

### 2.2 异步等待态 (Async Pending)
- **触发时机**：`POST /diagnose` 触发后，等待异步解析和生成。
- **UI 呈现**：全屏或局部 Progress 进度条，配以循环文案（“正在提取架构摘要...”、“正在评估维度...”）。允许用户离开，提示“您可前往工作台等待通知”。

### 2.3 异常与空态 (Error & Empty)
- **Empty Placeholder**：例如进入未生成诊断的会议室，展示插画与按钮 `[前往生成诊断书]`。
- **断连态 (Disconnect Banner)**：SSE 断开时，顶部出现黄色 Banner `[网络连接异常，正在尝试重连...]`。

---

## 3. Mock API 数据样例 (Mock Data)

在后端完善前，前端可直接使用以下 Mock JSON 数据进行绑定开发。

### Mock: `GET /api/reviews/123/diagnosis`
```json
{
  "data": {
    "summary": "重构订单系统，使用 Go 微服务替换原有 PHP 单体，引入 Redis 集群解决高并发下的库存超卖问题。",
    "tags": ["微服务", "高并发", "架构重构"],
    "radarDimensions": [
      { "name": "性能", "score": 90 },
      { "name": "可用性", "score": 85 },
      { "name": "成本", "score": 60 }
    ],
    "recommendedRoles": [
      { "roleId": "r1", "roleName": "架构师", "weight": 40 },
      { "roleId": "r2", "roleName": "PMO", "weight": 30 }
    ]
  }
}
```

### Mock: `GET /api/reviews/123/meeting/session`
```json
{
  "data": {
    "status": "running",
    "agents": [
      { "roleName": "架构师", "status": "done" },
      { "roleName": "安全合规", "status": "speaking" }
    ],
    "speechCards": [
      {
        "id": "s1",
        "agentName": "架构师",
        "dimension": "性能与可用性",
        "riskLevel": "medium",
        "content": "Redis 集群虽能解决读写瓶颈，但跨机房同步存在延迟，需考虑最终一致性补偿方案。"
      }
    ]
  }
}
```

---

## 4. G01-G24 UI 降级方案 (UI Degradation Plan)

根据规格中列出的 API 缺口，为了保障 Sprint 1 的可交付性，采取以下 UI 降级策略：

### P0 缺口降级（阻塞型，需前端自行补偿）
- **G01 (诊断雷达图无结构化)**：前端尝试使用正则/JSON.parse 解析后端字符串；若解析失败，**降级为不显示雷达图**，仅展示纯文本诊断结果。
- **G05 (无排除已选角色的 API)**：前端请求全量 `/roles` 列表，在本地使用 `filter` 剔除已在 `recommendedRoles` 中的角色，实现选择器的数据过滤。
- **G10 (SSE 事件未定)**：若 SSE 联调受阻，前端启用 `setInterval` 轮询方案（如每 2 秒调用一次 `GET /session`），通过比对数据长度追加 `SpeechCard`。
- **G13 (报告评级无字段)**：前端根据 `opinions` 数组中的 `high` 风险数量，本地通过规则推导评级（如含 `high` 风险即为“有条件通过”）。
- **G21 (无权限状态)**：MVP 阶段在代码中硬编码所有按钮为可点击状态，暂不拦截 UI。
- **G22 (命名格式)**：在 Axios interceptor 中统一增加 snake_case 到 camelCase 的递归转换。

### P1 缺口降级（体验下降型）
- **G02 (无推荐理由)**：直接隐藏“推荐理由”文本框，只显示角色名称。
- **G06 (发言卡片仅有 UUID)**：前端在进入页面时提前获取一次 `/roles`，在本地建立 `id -> name` 字典进行映射。
- **G07, G14, G15, G16, G20 (各类统计聚合字段)**：全部由前端拉取全量明细数据后，在本地 `useEffect` 中计算（发言次数、采纳率、耗时、均分等）。若数据结构不支持计算，则直接**隐藏对应 UI 区块**。

### P2 缺口降级（直接屏蔽功能）
- **G04 (进度流)**：点击生成后，显示死循环 Loading，不展示百分比。
- **G08 (断连补发标识)**：UI 取消“补发”的特殊视觉标识，当作正常消息展示。
- **G09 (干预记录)**：移除右侧栏的干预历史列表 UI。
- **G17 (2x2 风险矩阵无坐标数据)**：降级为普通的“风险卡片列表”，不使用 2x2 图形化展示。
- **G18, G19 (外部推送与人工确认状态)**：UI 移除对应的操作按钮和状态标。
