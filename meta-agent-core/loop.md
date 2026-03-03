### 核心执行逻辑（按一次循环的顺序）

下面是 `runLoop`（`runtime/loop.ts`）的主线逻辑，用人话梳一遍：

1. **初始化与记忆挂钩**
   - 第一次迭代时，把 `state.goal` 记录到 `Memory` 里，作为本次任务的 `userRequest`。

2. **循环开始：`while (true)`，每次一轮迭代**
   - `state.iterationCount++`。

3. **中断检查（Interrupt → Paused）**
   - 从 `InterruptChannel` 里 `poll()` 看有没有用户中断。
   - 如果有：
     - 调 `Harness.snapshot("interrupt-iter-X")` 快照当前工作目录。
     - 如果 `canTransition(currentMode, 'paused')`，切到 `paused`，往 `Trace` 写一条 `interrupt`。
     - 调 `hooks.onInterrupt`（如果有）拿到 `UserDirective`：
       - `stop`：写 `stop` trace，回调 `config.onStop`，返回 `{ status: 'completed' }`。
       - `modify_goal`：修改 `state.goal`，mode 切回 `plan`。
       - 其它（`continue`）：mode 切回 `plan`。

4. **终止条件（三种）**
   - **迭代超限**：`iterationCount >= maxIterations` → 写 `stop(budget_exceeded)`，更新 `Memory.solutionSummary`，保存 `state`，返回 `{ status: 'budget_exceeded' }`。
   - **连续无增益**：`noProgressCount >= maxNoProgress` → 写 `escalate`，更新 `Memory.solutionSummary`，保存 `state`，返回 `{ status: 'escalated' }`。
   - **目标完成**：没有 `currentSubgoal` 且 `subgoals` 为空 → 写 `stop(goal_completed)`，更新 `Memory.solutionSummary`，保存 `state`，返回 `{ status: 'completed' }`。

5. **Collect 阶段（观测）**
   - 调 `collect(config.collectConfig, primitives, trace.filterByTag, skillsDir)`，得到 `collectResult`（含 `context` 和 `confidence`）。
   - 把 `context` 写入 `TerminalLog`，并用同一个 `seq` 写入 `Trace` 的 `collect` 条目（包括 `input/output/confidence`）。
   - 如果 `coverage` 低但还在 mid–high 之间，就最多重试 `maxCollectRetry` 次，再次 collect 并记录。
   - 如果最终 `coverage` 或 `reliability` 低于 `confidenceLow` → 直接 `escalate`，回调 `onEscalate`，返回 `{ status: 'escalated' }`。

6. **Plan 模式（`state.mode === 'plan'`）**
   - 当前任务 = `state.currentSubgoal ?? state.goal`。
   - 调 `llm.reason(context, task)` 得到一个 `proposal` + `uncertainty`：
     - 记录到 `TerminalLog`（llmcall）和 `Trace`（kind=`reason`，含 input/output/uncertainty）。
   - **高不确定性处理**：
     - 如果 `uncertaintyScore > uncertaintyHigh`：
       - **如果 `proposal` 里包含 `<invoke name="...">` 工具调用**：  
         - 不直接升级，而是记录 narrative，然后仍然把原始 `proposal` 存进 `state.custom['pendingProposal']`，给执行阶段用。
       - 否则：
         - 调 `llm.reasonMulti` 拿多个 candidates，再调 `llm.judge('selection', ...)` 做方案仲裁：
           - 都写入 `TerminalLog` + `Trace`（`kind: 'reason'` 和 `kind: 'judge'`）。
           - 如果多候选的不确定性仍然太高 → `escalate`。
           - 否则，把 judge 的决策存进 `state.custom['pendingProposal']`。
     - 如果 `uncertaintyScore <= threshold`：直接把 `reason` 的结果存进 `pendingProposal`。

   - **风险评估（Judge risk）**
     - 使用 `state.custom['pendingProposal']` 调 `llm.judge('risk', context, proposal)`。
     - 写 `TerminalLog` + `Trace(kind='judge', judge_type='risk')`。
     - 解析 result 文本里是否包含 “通过/pass/approved/yes/allow/允许” 等提示：
       - 如果没有通过，或者 risk 的不确定性也太高 → `escalate`。
   - **模式切换：Plan → Execute**
     - 如果 `canTransition(mode, 'execute')`：
       - 调 `hooks.onModeTransition`（如果有），
       - 更新 `state.mode = 'execute'`、`version++`，写一条 state trace（`plan→execute`），然后 `continue` 到下一轮循环（下一轮会走到 Execute 分支）。

7. **Execute 模式（`state.mode === 'execute'`）**
   - 拿出 `proposal = state.custom['pendingProposal']`。
   - **快照策略**：
     - 如果 `hooks.shouldSnapshot(state)` 返回 true：
       - 用 `Harness.snapshot("iter-X")` 做快照；失败则 `escalate`（防止在不可回滚下执行危险动作）。
   - **执行前 Hook**：
     - `hooks.onBeforeExec(state, proposal)` 如果返回 `'block'` → 直接 `escalate`。
   - **真正执行工具调用**：
     - 调 `executeToolCalls(proposal, primitives)`：
       - 用正则解析 `<invoke name="Bash|Read|Write|Edit">` 块。
       - 针对每个工具分别调用 `primitives.bash/read/write/edit`，把结果拼成字符串。
     - 把执行结果存到 `state.custom['lastExecResult']`。
     - 同时写入 `TerminalLog`（operation=`bash`，其实是“执行阶段的结果”）和 `Trace(kind='exec')`，带上统一的 `seq`。
   - **模式切换：Execute → Review**
     - `canTransition(mode, 'review')` 时：
       - 调 `hooks.onModeTransition`，设置 `mode = 'review'`，`version++`，写 state trace（`execute→review`），再 `continue`。

8. **Review 模式（`state.mode === 'review'`）**
   - 构造 `outcomeInput`，包含：
     - 当前目标（子目标或总 goal）、`pendingProposal`、`lastExecResult`。
   - 调 `llm.judge('outcome', context, outcomeInput)` 判断是否达成。
   - 写 `TerminalLog` + `Trace(kind='judge', judge_type='outcome')`。
   - 解析 result 判断：
     - 如果 **未达成** 或 不确定性过高：
       - `state.noProgressCount++`；
       - 如果 `noProgressCount >= maxNoProgress`：不立刻结束，留到下一轮开头由终止条件触发。
       - 如果可以 `review → recovery`：切 mode 为 `recovery`，写 state trace，然后 `continue`。
     - 如果 **达成**：
       - 如有 `currentSubgoal`：
         - 写一条 narrative trace（标记子目标完成与大致结论）。
         - 构造 `ArchivedSubgoal`（包含 goal & summary & outcome='completed'） push 到 `archivedSubgoals`；从 `subgoals` 中移除当前子目标，并切换到下一个。
       - `noProgressCount = 0`。
       - 如果还有剩余 `subgoals`：
         - 切回 `plan`（`review→plan`），写 state trace，然后 `continue`。
       - 如果没有子目标了：下一轮的终止条件会检测到 goal 已完成并 stop。

9. **Recovery 模式（`state.mode === 'recovery'`）**
   - 写一条 `state` / narrative trace 表示进入诊断与回退。
   - `hooks.classifyError(error)`（如提供）可以决定是否需要回滚：
     - 如果错误是 retryable：
       - 不回滚，直接 `recovery→plan`，再继续。
     - 否则：
       - 调 `Harness.rollback()` 把工作目录回滚到快照。
       - 清空 `pendingProposal`，`recovery→plan`，再继续。

10. **Paused 模式**
    - 实际逻辑已在开头 Interrupt 阶段处理；到这个分支时只是提醒“Paused 要切走”，真正切走时已经通过 `onInterrupt` 的指令完成。

11. **每轮结尾：状态持久化**
    - 每次迭代尾部调用 `StateManager.save(agentDir, state)` 写 `state.json`，保证随时可恢复。

