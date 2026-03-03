# 代码修改说明

以下修改使代码实现与 README.md 设计文档保持一致。按顺序执行。

---

## 1. 删除 `risk` 和 `selection` JudgeType

**文件：** `src/core/llm.ts`

将 JudgeType 定义改为：

```typescript
JudgeType = 'outcome' | 'milestone' | 'capability'
```

然后全局搜索 `'risk'` 和 `'selection'` 作为 JudgeType 的所有调用点，一并删除。风险评估由 Reason 输出的 `riskApproved` 字段承担，不需要独立的 Judge 调用。

---

## 2. 删除 AGENT.md 配置类型中的 `risk` 和 `selection` 字段

**文件：** `src/index.ts`（第 51-57 行附近）

将 judge 配置类型改为：

```typescript
judge?: {
  outcome?: 'required' | 'rule_based' | 'disabled';
  milestone?: 'enabled' | 'disabled';
  capability?: 'enabled' | 'disabled';
};
```

---

## 3. 将 `observe` kind 替换为 `exec`

**文件：** `src/core/trace.ts`

从 TraceEntry 的 kind 联合类型中删除 `'observe'`，最终为：

```typescript
kind: 'collect' | 'reason' | 'judge' | 'exec' | 'state' |
      'escalate' | 'stop' | 'interrupt' | 'narrative';
```

**文件：** `src/core/primitives.ts`（第 141-144 行附近）

将 `read` 和 `bash` 操作写入 Trace 时的 kind 从 `'observe'` 改为 `'exec'`。

---

## 4. 删除 Loop 骨架中工具调用豁免的硬编码逻辑

**文件：** `src/runtime/loop.ts`（第 83-95 行附近）

删除 `hasToolCalls` 函数，以及 uncertainty 过高时检查工具调用的条件分支。改为 uncertainty 过高时直接 Escalate：

```typescript
// 删除类似以下逻辑：
if (uncertaintyHigh && hasToolCalls(proposal)) {
  // 继续执行（豁免）
} else if (uncertaintyHigh) {
  return escalate(...)
}

// 改为：
if (uncertaintyHigh) {
  return escalate(...)
}
```

---

## 5. 在 Reason 的 system prompt 中注入工具调用说明

**文件：** 构造 Reason system prompt 的位置（`src/core/llm.ts` 或 `src/runtime/loop.ts` Plan 阶段）

在 Reason 的 system prompt 末尾增加以下文字：

```
若你的提案中包含工具调用（<invoke> 格式），uncertainty 评分应基于工具调用
执行后的预期状态来评估，而非将工具调用符号本身视为不确定因素。包含工具
调用的提案通常意味着需要先获取上下文再做判断，应给予较低的 uncertainty
评分以允许执行。
```

---

## 6. 将 `lastExecResult` 从 `state.custom` 迁移为顶层字段

**文件：** `src/runtime/state.ts`

在 `AgentState` 类型中添加顶层字段（`pendingProposal` 已是顶层字段，确认无需修改）：

```typescript
lastExecResult?: string;    // Execute 产出，Review 消费
```

**文件：** `src/runtime/loop.ts`

Execute 阶段（第 430 行附近），将：
```typescript
state.custom['lastExecResult'] = execResult;
```
改为：
```typescript
state.lastExecResult = execResult;
```

Review 阶段构造 `outcomeInput` 处（第 463-466 行附近），将读取 `state.custom['lastExecResult']` 改为读取 `state.lastExecResult`。

---

## 修改汇总

| # | 文件 | 操作 |
|---|------|------|
| 1 | `src/core/llm.ts` | 删除 risk/selection JudgeType 及其调用点 |
| 2 | `src/index.ts` | 删除 judge 配置中的 risk/selection 字段 |
| 3 | `src/core/trace.ts`、`src/core/primitives.ts` | observe kind 替换为 exec |
| 4 | `src/runtime/loop.ts` | 删除工具调用豁免逻辑及 hasToolCalls 函数 |
| 5 | `src/core/llm.ts` 或 `src/runtime/loop.ts` | Reason system prompt 注入工具调用说明 |
| 6 | `src/runtime/state.ts`、`src/runtime/loop.ts` | lastExecResult 迁移为顶层字段 |



# Todos
[x] 删除 risk 和 selection JudgeType (src/core/llm.ts)
[x] 删除 AGENT.md 配置类型中的 risk/selection 字段 (src/index.ts)
[x] 将 observe kind 替换为 exec (src/core/trace.ts, primitives.ts)
[x] 删除 Loop 骨架中工具调用豁免逻辑 (src/runtime/loop.ts)
[x] 在 Reason system prompt 中注入工具调用说明
[x] 将 lastExecResult 迁移为顶层字段 (state.ts, loop.ts)
[x] 调试 survey_agent_python/run.py 并测试修改正确性

所有 meta-agent-core/change.md 要求的修改已完成。以下是修改汇总：

## 修改完成情况

| # | 文件 | 操作 | 状态 |
|---|------|------|------|
| 1 | `src/core/llm.ts` | 删除 risk/selection JudgeType 及其调用点 | ✅ |
| 2 | `src/index.ts` | 删除 judge 配置中的 risk/selection 字段 | ✅ |
| 3 | `src/core/trace.ts`, `primitives.ts` | observe kind 替换为 exec | ✅ |
| 4 | `src/runtime/loop.ts` | 删除工具调用豁免逻辑 (hasToolCalls 函数) | ✅ |
| 5 | `src/core/llm.ts` | Reason system prompt 注入工具调用说明 | ✅ |
| 6 | `src/runtime/state.ts`, `loop.ts` | lastExecResult 迁移为顶层字段 | ✅ |

## 测试结果

运行 `survey_agent_python/run.py` 后的 trace.jsonl 分析：

1. **✅ observe → exec 修改成功**: trace 中所有 `kind` 字段现在都是 `"exec"`，不再是 `"observe"`
2. **✅ JSON 解析正常**: LLM 返回的 JSON 被正确解析，没有出现 "JSON 解析失败" 错误
3. **⚠️ uncertainty 仍为 0.80**: LLM 虽然输出了包含工具调用的提案，但 uncertainty 评分仍为 0.80（超过阈值 0.7）

关于 uncertainty 评分：这是 LLM 本身的行为，虽然我们在 system prompt 中添加了关于工具调用的说明，但 LLM 仍然给出了较高的 uncertainty 评分。这可能需要进一步优化 prompt 或调整阈值，但这已经超出了 change.md 的修改范围。
