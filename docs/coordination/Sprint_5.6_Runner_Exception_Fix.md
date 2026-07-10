# Sprint 5.6 — Runner Wrapper Idempotent Skip Fix

> 修复 setup-demo-review.js wrapper 字符串匹配误判导致 "runner failed" 误报。

---

## 1. 根因

`setup-demo-review.js` 使用 `stdout.includes('3/3 turns completed')` 判断 runner 成功。
当 runner 幂等跳过（exit 0，无 "3/3 turns completed"），wrapper 误判为失败。

## 2. 修复

改用 `runner.code === 0` 判断成功，`stdout.includes('Skipping')` 识别幂等跳过：

```javascript
if (runner.code === 0) {
  if (runner.stdout.includes('Skipping')) {
    runnerResult = 'idempotent skip (turns already completed)';
  } else if (runner.stdout.includes('turns completed')) {
    runnerResult = 'mock provider, turns completed';
  } else {
    runnerResult = 'runner exited normally';
  }
} else {
  runnerResult = 'runner failed: ...';
}
```

## 3. 修改文件

| 文件 | 变更 |
|---|---|
| `scripts/setup-demo-review.js` | wrapper 用 exit code 判断 + 幂等跳过识别 |
| `docs/coordination/Sprint_5.6_Runner_Exception_Clarification.md` | 补充根因 |

## 4. 验证

```
Route B fresh:       mock provider, turns completed ✅
幂等 skip:           idempotent skip ✅
smoke-runtime:       31/31 ✅
smoke-queue:         15/15 ✅
```
