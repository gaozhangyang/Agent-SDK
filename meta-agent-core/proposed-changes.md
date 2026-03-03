# 待合入的设计修改

> 基于讨论结论，尚未写入主文档。

---

## 修改 1：明确 `archivedSubgoals` 的数据结构

**位置：** 编排层 → State 结构体

**现状：** `archivedSubgoals: string[]`，只存子目标描述字符串。

**修改为：**

```typescript
archivedSubgoals: Array<{
  goal: string;
  summary: string;       // 该子目标的解决结论
  outcome: 'completed' | 'voided';  // voided = 被 Recovery 回滚，此路不通
}>
```

**理由：** 当前任务的后续子目标在规划时需要知道"前面做了什么、结论是什么"，光有 goal 字符串不够。

---

## 修改 2：`MemoryEntry` 内嵌子目标明细

**位置：** 核心层 5 → Memory 长期记忆

**现状：**

```typescript
MemoryEntry = { ts, userRequest, solutionSummary, sessionId?, archivedSubgoal? }
```

**修改为：**

```typescript
MemoryEntry = {
  ts,
  sessionId?,
  userRequest,           // 用户原始请求
  solutionSummary,       // 任务整体总结
  subgoals: Array<{      // 新增：子目标明细
    goal: string;
    summary: string;
    outcome: 'completed' | 'voided';
  }>
}
```

**理由：**
- 检索入口保持任务级（按用户请求检索），不引入碎片化的子目标独立条目。
- 检索命中后能拿到完整子目标细节，包括走不通的路径（`voided`）——"此路不通"本身是有价值的历史记忆。
- 子目标数据直接从 `State.archivedSubgoals`（修改 1）同步写入，无需额外采集。

---

## 修改 3：补充 Memory 与 State 的边界说明

**位置：** 核心层 5 → Memory 长期记忆，开头增加一段说明

**新增文字：**

> Memory 与 State 的分工：State 记录"现在"（当前任务的实时快照，随迭代覆写），Memory 记录"历史"（跨任务的档案，只增不改）。当前任务内已完成的子目标存入 `State.archivedSubgoals`，供当前任务后续步骤参考；任务终止时，将完整的子目标列表随任务总结一并写入 Memory，供未来任务检索。两者不合并，原因是生命周期不同（快照 vs 档案）、读写模式不同（整体加载 vs 按需检索）、增长方式不同（有界 vs 无界）。
