# Sprint 5.6 — Runner Exception Clarification

> 复现并分析 Sprint 5.5 中 runner 异常，判断是预期行为还是脚本 bug。

## 根因

**wrapper 字符串匹配误判，不是 runner 失败。** `setup-demo-review.js` 使用 `stdout.includes('3/3 turns completed')` 判断成功。当 runner 幂等跳过（exit 0，无 "3/3 turns completed"），wrapper 误报为 "runner failed"。

**修复**：改用 `runner.code === 0` 判断成功，加 `stdout.includes('Skipping')` 识别幂等跳过。

---

## 1. 复现结果

### Route B demo (setup-demo-review --with-runner)

```
✅ Review created: "PrismReview MVP Demo"
✅ Diagnosed
✅ Roles saved: CTO, CFO, PMO
✅ Review started (status: running)
⏳ Running agent turns...
✅ mock provider, 3/3 turns completed
Route: B (runner + DB opinions)
Report src: db_opinions
```

**结论：Route B 正常运行，3/3 turns completed。**

### Idempotent skip

```
⚠️  Found 3 completed turn(s). Skipping — idempotent guard active.
```

**结论：幂等跳过正确运行。**

### --force re-run

```
🧹 --force: cleaning 3 existing turn(s) and their opinions...
✅ 3/3 turns completed, 0 failed (0.1s)
```

**结论：--force 清理并重新执行正确运行。**

---

## 2. 异常分类判断

| 可能原因 | 是否发现 | 说明 |
|---|---|---|
| 已完成 review 幂等跳过 | ✅ | 预期行为，exit 0，打印 skip 消息 |
| review 状态不符合预期 | ❌ 未发现 | Route B 创建的 review 正确变为 running |
| DB seed/roleVersion 缺失 | ❌ 未发现 | 5 preset roles 的 activeVersionId 均存在 |
| 脚本真实 bug | ❌ 未发现 | 三个场景均正常 |

## 3. 可能触发的场景

如果 Sprint 5.5 中 runner 返回异常，最可能的原因是：

| 场景 | 表现 | 解决方案 |
|---|---|---|
| review 已经 completed（之前跑过） | "Review status is completed, expected running" | 使用 `--force` |
| review status 是 ready（JSON roleSelection 未保存） | "No role selection found" | 先 save roles 再 start |
| Prisma 连接失败 | ECONNREFUSED / P1001 | 检查 Docker postgres 是否 running |

## 4. 代码审查结论

**无需修复。** Runner 行为在三个验证场景中均正确：
- 首次执行：3/3 turns completed ✅
- 幂等跳过：跳过已有 completed turns ✅  
- --force 重新执行：清理后成功执行 ✅

## 5. 验证

```
smoke-runtime: 31/31 ✅
smoke-runner:   11/11 ✅
smoke-queue:    15/15 ✅
```
