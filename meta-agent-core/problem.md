# README 与代码实现不一致问题

本文档记录 meta-agent-core 项目中，代码实现与 README.md 设计文档不一致的地方。

---

## 1. TraceEntry 的 kind 字段多了 'observe' 类型

**README 描述：**
```
kind: 'collect' | 'reason' | 'judge' | 'exec' | 'state' |
      'escalate' | 'stop' | 'interrupt' | 'narrative';
```

**代码实现：**
- `src/core/trace.ts` 第 23-24 行还包含 `'observe'` 类型
- `src/core/primitives.ts` 第 141-144 行：当操作是 `read` 或 `bash` 时，kind 设为 `'observe'`

---

## 2. JudgeType 类型多了 'risk' 和 'selection'

**README 描述：**
- `type ∈ { outcome, milestone, capability }`

**代码实现：**
- `src/core/llm.ts` 第 5 行：`JudgeType = 'outcome' | 'risk' | 'selection' | 'milestone' | 'capability'`
- 新增了 `risk`（判断操作是否允许执行）和 `selection`（从多个候选方案中选出最优）

---

## 3. AGENT.md 运行时配置多了 'risk' 和 'selection' 配置项

**README 描述：**
```json
"judge": {
  "outcome": "required",
  "milestone": "enabled",
  "capability": "enabled"
}
```

**代码实现：**
- `src/index.ts` 第 51-57 行还有 `risk` 和 `selection` 配置项：
```typescript
judge?: {
  outcome?: 'required' | 'rule_based' | 'disabled';
  risk?: 'enabled' | 'disabled';
  milestone?: 'enabled' | 'disabled';
  capability?: 'enabled' | 'disabled';
  selection?: 'enabled' | 'disabled';
};
```

---

## 4. pendingProposal 从 custom 字段升级为强类型字段

**README 描述：**
- State 结构中 `pendingProposal` 存储在 `custom: Record<string, unknown>` 中

**代码实现：**
- `src/runtime/state.ts` 第 22 行：`pendingProposal?: string;` 是 AgentState 的顶层字段
- `src/runtime/loop.ts` 第 368 行直接使用 `state.pendingProposal`

---

## 5. onAfterObserve hook 在 loop.ts 中未被调用

**README 描述：**
- LoopHooks 接口包含 `onAfterObserve?: (state, result) => Promise<'continue' | 'recover' | 'escalate'>`

**代码实现：**
- `src/runtime/loop.ts` 中没有调用 `onAfterObserve` hook
- `src/hooks/mode-state-machine.ts` 第 32-38 行实现了该 hook，但 loop.ts 没有使用它

---

## 6. executeToolCalls 函数未在 README 中提及

**README 描述：**
- README 中没有提到 LLM 返回的工具调用需要实际执行

**代码实现：**
- `src/runtime/loop.ts` 第 24-81 行有 `executeToolCalls` 函数
- 用于解析并执行 `<invoke name="X">...</invoke>` 格式的工具调用
- `src/runtime/loop.ts` 第 427 行调用此函数执行 LLM 返回的工具调用

---

## 7. 权限状态机规则细节差异

**README 描述：**
- Level 2: 受控执行，bash（常规，无网络/删除）
- Level 3: 高风险执行，bash（网络、删除、系统级变更）

**代码实现：**
- `src/hooks/permission-guard.ts` 第 21-24 行：
  - Level 2: `bash\s*\(|exec\s*\(|spawn\s*\(`（所有 bash 命令都需要 Level 2）
  - Level 3: `rm\s+-rf|delete\s+|DROP\s+|truncate\s+` 和 `curl|wget|fetch|http:|https:`

---

## 8. archivedSubgoals 字段名称

**README 描述：**
- README 第 262-266 行提到了 archivedSubgoals 的数组结构，但没有明确字段名

**代码实现：**
- `src/runtime/state.ts` 第 21 行明确字段名为 `archivedSubgoals: ArchivedSubgoal[]`

---

## 9. MemoryEntry 包含 subgoals 字段

**README 描述：**
- MemoryEntry 结构中未明确提及 subgoals 字段

**代码实现：**
- `src/core/memory.ts` 第 31 行：`subgoals?: Subgoal[];`

---

## 10. Trace 和 TerminalLog 使用相同的 seq（全局序号管理器）

**README 描述：**
- README 第 26 行提到 "Trace 和 Terminal Log 通过 seq 序号关联"

**代码实现：**
- `src/core/trace.ts` 第 61-114 行实现了 `GlobalSeqManager` 类
- `src/runtime/loop.ts` 中使用 `terminalLog.append()` 返回的 seq 来写入 Trace
- primitives.ts 中也使用相同的 seq 确保一致性

---

## 11. Terminal Log 文件格式

**README 描述：**
- README 第 127 行提到 "terminal.md（人类阅读，含操作图标和折叠块）"

**代码实现：**
- `src/core/trace.ts` 第 237 行：TerminalLog 使用 `terminal.md` 文件名
- 代码实现了完整的 Markdown 格式化逻辑

---

## 13. 高不确定性处理流程差异

**README 描述：**
- Plan 阶段：LLMCall[Reason] → { proposal, uncertainty, riskApproved }
- uncertainty 过高 → Escalate

**代码实现：**
- `src/runtime/loop.ts` 第 83-95 行有 `hasToolCalls` 函数
- 当 uncertainty 过高时，先检查是否包含工具调用 `<invoke name="X">`
- 如果有工具调用：仍然继续执行，不直接 Escalate
- `loop.ts` 第 358 行：只有 riskApproved === false 或 uncertainty 过高时才 Escalate

---

## 14. Review 阶段构造的输入内容差异

**README 描述：**
- Review 阶段：LLMCall[Judge(outcome)] → 达成 / 未达成

**代码实现：**
- `src/runtime/loop.ts` 第 463-466 行构造 `outcomeInput`：
  ```
  目标: {currentSubgoal ?? goal}
  执行提案: {pendingProposal}
  执行结果: {lastExecResult}
  ```
- 包含了三部分内容，而不仅仅是目标

---

## 15. Execute 阶段将执行结果存储到 state.custom

**README 描述：**
- README 没有明确描述 Execute 后的结果如何传递到 Review

**代码实现：**
- `src/runtime/loop.ts` 第 430 行：`state.custom['lastExecResult'] = execResult;`
- 在 Execute 阶段将执行结果存储到 state.custom 中
- Review 阶段（`loop.ts` 第 463 行）读取该结果构造输入

---

## 16. Memory 记录时机差异

**README 描述：**
- 没有明确描述 Memory 的记录时机

**代码实现：**
- `loop.ts` 第 171-176 行：任务开始时（iterationCount === 1 && archivedSubgoals.length === 0）记录 userRequest
- `loop.ts` 第 229-231、243-245、257-262 行：任务终止时更新 solutionSummary

---

## 17. archivedSubgoals 的 outcome 字段包含 'voided' 状态

**README 描述：**
- README 第 262-266 行只提到 outcome: 'completed' | 'voided'

**代码实现：**
- `src/runtime/state.ts` 第 14 行：`outcome: SubgoalOutcome;` 其中 SubgoalOutcome = 'completed' | 'voided'
- 'voided' 表示被 Recovery 回滚，此路不通

---

## 18. State 持久化位置差异

**README 描述：**
- "[每轮结尾] StateManager.save(state)"

**代码实现：**
- `src/runtime/loop.ts` 第 597 行：在每次迭代结尾保存
- 同时在多个 return 分支前也保存（`loop.ts` 第 235、248、265 行），确保状态不会丢失

---

## 19. Judge 输出包含 uncertainty 字段

**README 描述：**
- Judge 类型描述中未明确 uncertainty 字段

**代码实现：**
- `src/runtime/loop.ts` 第 487 行：Judge 调用结果包含 uncertainty
- Review 阶段会检查 outcomeUncertaintyScore > uncertaintyHigh

---

## 20. confidence 不足判断逻辑

**README 描述：**
- Collect 阶段：confidence 不足 → Escalate

**代码实现：**
- `loop.ts` 第 300-313 行：判断条件是 coverage < confidenceLow 或 reliability < confidenceLow
- 默认阈值：confidenceLow = 0.3（`loop.ts` 第 116 行）

---

## 总结

代码实现相比 README 有以下主要扩展：

1. 新增 `observe` kind 类型用于读写操作
2. 新增 `risk` 和 `selection` Judge 类型
3. pendingProposal 升级为强类型字段
4. 实现了 executeToolCalls 来实际执行 LLM 返回的工具调用
5. 权限状态机规则更细化
6. 使用全局序号管理器统一 Trace 和 TerminalLog 的 seq
7. 高不确定性时优先检查是否包含工具调用
8. Review 阶段构造更完整的输入（包含执行结果）
9. loop.md 文档过时，需要同步更新

这些差异表明代码实现比 README 文档更加完善，建议同步更新 README.md 和 loop.md 以保持一致。
