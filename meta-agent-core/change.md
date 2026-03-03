# runLoop 修改清单

> 对应文件：`runtime/loop.ts`
> 原则：极度简约，但功能完备，非必要不复杂。

---

## 1. 删除 reasonMulti + judge('selection') 分支

**位置**：Plan 阶段，高不确定性处理逻辑。

**现状**：
```
uncertaintyScore > uncertaintyHigh 且没有工具调用
  → llm.reasonMulti 拿多个 candidates
  → llm.judge('selection') 做仲裁
  → 多候选不确定性仍高 → escalate
  → 否则存入 pendingProposal
```

**修改**：删除整个 `reasonMulti + judge('selection')` 分支。

**替代方案**：在 `llm.reason` 的 system prompt 里加一条指令：
```
如果不确定，优先选择副作用最小的行动。
```

**理由**：把不确定性的消化推回模型侧，orchestrator 只做状态流转，不做内容判断。

---

## 2. 合并 reason + judge('risk') 为 reason 的单次调用

**位置**：Plan 阶段，`llm.reason` 之后的 `llm.judge('risk')` 调用。

**现状**：
```
llm.reason(context, task) → proposal + uncertainty
llm.judge('risk', context, proposal) → 是否通过风险评估
```

**修改**：删除独立的 `judge('risk')` 调用。在 `llm.reason` 的输出结构里增加一个 `riskApproved` 字段（boolean），由模型在 reason 时一并输出。

**新的 reason 输出结构**：
```typescript
{
  proposal: string,
  uncertainty: { score: number, reasons: string[] },
  riskApproved: boolean,   // 新增：模型自评此提案是否可安全执行
  riskReason?: string      // 可选：风险说明
}
```

**处理逻辑**：
- `riskApproved === false` 或 `uncertainty.score > uncertaintyHigh` → escalate
- 否则 → 存入 `state.pendingProposal`，切 execute

**Trace 记录**：`riskApproved` 和 `riskReason` 写入 `kind: 'reason'` 条目，不再产生独立的 `kind: 'judge', judge_type: 'risk'` 条目。

---

## 3. 重新设计 Collect：降级为静态拉取，智能探索上移为 SmartCollect

### 3a. 删除重试，Collect 降级为静态原语

**位置**：Collect 阶段。

**现状**：`coverage` 低但在 mid–high 之间时，最多重试 `maxCollectRetry` 次。内部还包含压缩、source 分发等复杂逻辑。

**修改**：Collect 只做一件事——按 sources 配置机械地拉取原始内容，做基本 token 截断，返回 rawContext。删除重试、压缩、以及任何智能探索逻辑。

```typescript
Collect(sources, limits) → { rawContext, confidence }
```

coverage/reliability 判断简化为两路：
```
confidence 足够  → 继续 Plan
confidence 不足  → escalate
```

**理由**：Collect 失败通常是环境或工具问题，重试无法解决。智能探索是 agent 行为，不应内置在静态函数里。

### 3b. 智能探索通过 SmartCollect 在上层实现

**性质**：SmartCollect 是调用 meta-core 本身的上层业务逻辑，与 Survey Agent 同层次，不修改 meta-core。

**实现方式**：用一个小 runLoop 实现，goal 是「为当前任务组装足够的 context」，maxIterations 设小（建议 5）：

```typescript
SmartCollect(goal, collectConfig) = runLoop({
  goal: "为当前任务组装足够的 context，输出压缩后的 rawContext",
  primitives: { bash, read, write, edit },
  maxIterations: 5
})
```

SmartCollect 内部的 Reason 可以自由组合以下行为（按需，保持简约）：
- `bash wc -c` / `bash wc -l` 统计文件大小，决定是否需要采样
- `bash grep` 检索关键词，判断文件相关性
- `read` 读取文件头部固定 token 数，递归决定是否继续深读
- `bash` 将大文件分 chunk，逐块判断是否纳入 context
- `bash` 过滤已被 Recovery 标记为 `status: 'voided'` 的 Trace 条目
- `LLMCall[Reason]` 对超长 source 生成摘要，替换原文

**理由**：这些行为的组合依赖中间结果，是动态决策过程，正是 agent loop 的定义。放进静态 Collect 只会让 meta-core 膨胀；作为上层应用，按需使用，不增加核心复杂度。

---

## 4. 将 state.custom['pendingProposal'] 改为强类型字段

**位置**：`State` 结构体定义，以及所有读写 `state.custom['pendingProposal']` 的位置。

**修改**：在 `State` 结构体中增加显式字段：
```typescript
type State = {
  // ... 已有字段
  pendingProposal?: string;   // Plan 阶段产出，Execute 阶段消费，Review 后清空
}
```

**同步修改**：
- Plan 阶段：`state.custom['pendingProposal'] = ...` → `state.pendingProposal = ...`
- Execute 阶段：`proposal = state.custom['pendingProposal']` → `proposal = state.pendingProposal`
- Review / Recovery 阶段：清空时使用 `state.pendingProposal = undefined`

**理由**：用字典传递跨阶段状态等于用全局变量代替函数参数，类型不安全，调试困难。

---

## 5. Paused 分支加防御性 throw

**位置**：Loop 主体的 mode switch，`case 'paused'` 分支。

**现状**：Paused 逻辑在循环开头的 Interrupt 检查阶段已处理完毕，`case 'paused'` 分支是空壳。

**修改**：在 `case 'paused'` 分支里加防御：
```typescript
case 'paused': {
  // 正常情况下不应到达此处：
  // Paused 的切走逻辑在循环开头的 Interrupt 检查阶段已完成。
  // 若执行到这里，说明 onInterrupt 没有正确切换 mode，属于内部错误。
  throw new Error('Illegal state: reached paused branch in main loop switch. onInterrupt must transition mode away from paused.');
}
```

---

## 6. noProgressCount 终止判断的位置注释

**位置**：循环开头的终止条件检查，以及 Review 阶段的 `noProgressCount++`。

**背景**：`noProgressCount` 在 Review 阶段自增，但终止判断在下一轮循环开头触发。这是有意设计：自增触发终止之前，需要先经过 Recovery 阶段回滚环境，交给上级一个干净的工作目录。

**修改**：在两处各加一条注释，说明这个跨轮次的设计意图。

**循环开头终止条件处**：
```typescript
// noProgressCount 在 Review 阶段自增，但终止判断故意放在下一轮循环开头。
// 原因：Review 判断「没有进展」后会先切到 Recovery 执行回滚，
// 确保 escalate 时向上级交出干净的工作目录。
// 因此这里触发 escalate 时，Recovery 已经完成了清理工作。
if (state.noProgressCount >= maxNoProgress) { ... }
```

**Review 阶段 noProgressCount++ 处**：
```typescript
state.noProgressCount++;
// 不在此处立即 escalate。
// 切到 Recovery 先回滚环境，下一轮循环开头的终止条件会触发 escalate。
if (canTransition(mode, 'recovery')) { ... }
```

---

## 7. snapshot 失败的 escalate reason 细化

**位置**：Execute 阶段，`Harness.snapshot()` 失败处理。

**现状**：
```typescript
const ok = await Harness.snapshot(`iter-${state.iterationCount}`);
if (!ok) { /* escalate */ }
```

**修改**：escalate 时在 reason 里带上 `snapshot_failed` 标识：
```typescript
const ok = await Harness.snapshot(`iter-${state.iterationCount}`);
if (!ok) {
  trace.append({
    kind: 'escalate',
    data: {
      reason: 'snapshot_failed',
      message: 'Cannot proceed: snapshot failed before executing tool calls. ' +
                'Possible causes: disk full, permission denied, or Harness misconfiguration. ' +
                'Refusing to execute without rollback capability.'
    }
  });
  onEscalate?.();
  return { status: 'escalated' };
}
```

**理由**：`snapshot_failed` 是系统性故障（磁盘、权限），与逻辑性 escalate 原因不同，上层需要能够区分，避免无效重试。
