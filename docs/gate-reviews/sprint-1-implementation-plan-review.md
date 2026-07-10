# Sprint 1 Implementation Plan Review

> 日期：2026-07-06  
> 输入：`docs/design/Implementation_Plan_Sprint1.md`、`docs/design/Frontend_Delivery_Plan.md`  
> 结论：后端 SoT-first 计划放行；前端计划有条件放行，需修正权限和字段转换降级策略。

## 1. 后端计划裁决

`docs/design/Implementation_Plan_Sprint1.md` 通过开码前评审。

放行理由：

- 明确不改 Prisma schema。
- Role Service 使用 `agent_roles` + `agent_role_versions`。
- Review Draft 使用 `reviews.diagnosis` / `reviews.role_selection` JSON。
- Knowledge Mock 使用 `knowledge_documents` + `knowledge_chunks`。
- 覆盖 G01/G05/G10/G21/G22/G24。
- 外部模型保持 mock。

## 2. 前端计划裁决

`docs/design/Frontend_Delivery_Plan.md` 有条件放行。

可以采用：

- 最小 props 策略。
- Loading / Async Pending / Empty / Disconnect 状态稿。
- Mock JSON 作为组件开发输入。
- G17 风险矩阵降级为风险卡片列表。
- G18/G19 暂时隐藏外部推送与人工确认状态。

必须修正：

### F1. G21 权限降级不可硬编码全部按钮可点击

前端不得在无权限接口时默认所有按钮可用。正确降级：

- 默认只开启只读视图。
- 创建、启动、删除、上传、推送等高影响操作默认 disabled。
- 若 `GET /api/auth/me` 不可用，显示权限未知提示。

### F2. G22 不做全局 snake_case → camelCase 递归转换

后端计划已裁决：API JSON response 使用 camelCase。前端不得再做全局递归转换，避免误伤 `metadata`、`diagnosis`、第三方 payload。

正确策略：

- API client 假设后端返回 camelCase。
- 仅在特定 legacy/mock adapter 中做显式字段映射。

### F3. G01 不再解析字符串诊断结果

后端已计划输出 `DiagnosisResultJson`。前端不做正则解析后端字符串。

正确降级：

- 若 `radarDimensions` 缺失，隐藏雷达图。
- 若 `summary` 缺失，显示空态或“诊断结果不完整”。

### F4. G05 本地过滤只能作为 fallback

后端将实现 `GET /api/roles?available_for_review={reviewId}`。前端优先调用该 API；只有 API 不可用时才本地过滤。

## 3. 开码顺序

### Backend first

1. Auth `/api/auth/me` + permissions。
2. GlobalExceptionFilter。
3. Role list + available_for_review。
4. Review draft + mock diagnosis + diagnosis schema。
5. Diagnose SSE。
6. Knowledge mock upload。

### Frontend parallel

1. App shell + Ant Design theme。
2. Diagnosis page with mock adapter。
3. Role selector and role weights。
4. Async pending / forbidden / error states。
5. API client types aligned to backend DTOs。

## 4. 禁止事项

- 不新增表。
- 不真实调用模型 API。
- 不上传真实企业文档到外部服务。
- 不绕过权限默认开放操作。
- 不用全局 snake_case converter 覆盖所有响应。

## 5. 最终裁决

Go for Sprint 1 coding with constraints.

后端可从 Phase 1 开始编码。前端可从 App shell、主题 token、诊断书 mock 页面开始编码。前端必须先修订 F1-F4 再进入 API 联调。
