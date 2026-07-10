# Sprint 5.6 — Final Fix: --review-id for Demo Wrapper

> 为 `setup-demo-review.js` 增加 `--review-id` 参数，让 wrapper 可针对同一 review 重跑 runner，覆盖真实幂等跳过路径。

---

## 1. 根因

之前 wrapper 始终创建新 review，无法在 smoke 中覆盖 "同一 review 幂等跳过" 分支。

## 2. 修复

| 文件 | 变更 |
|---|---|
| `scripts/setup-demo-review.js` | 新增 `--review-id=<id>` 参数。传入时跳过创建/诊断/角色/start，直接跑 runner + report 检查 |
| `scripts/smoke-runner.js` | 第二次用 `--review-id=<id> --with-runner` 调用，验证 wrapper 输出 "idempotent skip" |
| `docs/demo/MVP_Demo_Runbook.md` | Route B 说明 `--review-id` 是 dev/test 辅助参数 |
| `docs/coordination/Sprint_5.6_Runner_Exception_Fix.md` | 补充说明 |

## 3. --review-id 行为

```
# 创建新 review + runner（默认行为，不变）
node scripts/setup-demo-review.js --with-runner

# 对已有 review 重跑 runner
node scripts/setup-demo-review.js --review-id=<id> --with-runner
```

## 4. 验证

```
smoke-runner: 15/15 ✅
  Wrapper --review-id: "idempotent skip" + NOT "runner failed" ✅
smoke-runtime: 31/31 ✅
```
