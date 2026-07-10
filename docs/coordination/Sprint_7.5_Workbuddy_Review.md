# Sprint 7.5 — WorkBuddy 快速 Gate 复审

> **模式**：快速 Gate（仅查 P0/P1）
> **复审对象**：`docs/coordination/Sprint_7.5_Demo_Readiness_Freeze.md`
> **基线**：`Sprint_7.4_Workbuddy_Review.md`（Go，快速 Gate）
> **日期**：2026-07-10
> **结论**：**Go（无保留）** — 6 项 P0/P1 全部通过，对照磁盘代码与 `.env` 取值取证。

---

## 证据（5 条）

1. **三态区分准确，未暗示真实模型默认启用**
   文档 §1/§2/§3 明确区分：默认 Mock（常驻 `:4000`）、Dev-only LM Studio（独立 `:4100` 进程内联 env）、未启用付费 API（§3.3 结构 GUARD）。§2 第 2 项将"真实模型是默认/标准 Demo 依赖"列为**禁止宣称**；`.env.example:21-24` 实测 `MODEL_PROVIDER="mock"`、`ALLOW_EXTERNAL_MODEL_CALLS=false`，与文档一致。

2. **单 review ≤3 cap 写清写全**
   §2.1 第 3 项、§3.2、§4.2 多处声明"代码硬约束 cap=3"。对应的 `queue.service.ts:180-196 applyPilotRoleCap()` 已在前序 Gate 逐字核对：env 未设→默认 3、非法值回退 3、仅 lmstudio+allow 时截断，pilot 关闭不影响默认 mock。

3. **弱输出 fallback_mock / failed ≠ 系统失败，口径明确**
   §4.1 给出四情形演示口径表（超时/空 JSON→fallback_mock 橙标"系统正常"；guard/401/403→failed 红标"fail-closed 正确拦截，非系统崩溃"；低置信度→蓝标如实记录），并立两条不可逾越红线：① 不得把 fallback_mock/failed 说成"真实模型成功"；② 不得因弱输出/failed 宣称"系统不可用"。与代码行为（fallback 单次不重试、guard NO_RETRY）完全对应。

4. **无密钥、无本机绝对路径、无代码改动**
   对 7.5 文档做 `sk-.../api_key/Bearer/C:\//d/workspace//Users//home/` 正则扫描**零命中**；§3 仅声明变量名与语义，未写真实 Key、未写绝对路径（仅含 `http://127.0.0.1:1234/v1` localhost URL，非文件路径）。源码侧 grep `7.5` 仅命中 7.3 既有 `applyPilotRoleCap` 代码与 7.4 残留 `pilot-instance.log`/tsbuildinfo 缓存，**无 7.5 源码改动**（纯文档冻结）。

5. **Stakeholder 口径平衡、不夸大**
   §1 仅列已验证能力，且将 LM Studio 第 6/7 项明确标为"dev-only 验证能力，非 MVP 对外标准 Demo"；§2 列出 10 条禁止宣称项（含付费 API、>3 调用、BullMQ、多用户鉴权等）；§4.4 给出冻结推荐话术——默认零 LLM 依赖、LM Studio 为可选受控路线。能力边界、弱输出兜底、付费 API 未启用均诚实呈现，无夸大。

---

## 备注（非阻塞）

- **`.env.example:9-10`** 仍含掩码形态的 `MINIO_SECRET_KEY="pris**********cret"`（历史既有，非 7.5 引入；文档本身 clean）。建议后续清理为纯占位，但不在本 Gate 范围内。
- **`apps/api/pilot-instance.log`** 为 7.4 E2E 运行残留日志（含 cap 警告行），非源码、非 7.5 产物，建议演示前清理以免混入交付物。
- 文档 §3 自身声明"不写本机绝对路径"，实际含 `http://127.0.0.1:1234/v1` 系 localhost URL，非文件系统绝对路径，不构成泄漏。
