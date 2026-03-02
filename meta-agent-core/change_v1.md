## change_v1：相对 v2 的最小改动点

### 1. Terminal Log 形式

- **存储层**：保持 `TerminalEntry` 的结构化 JSONL 形式不变（`command/stdout/stderr/exitCode/duration`），便于检索与程序处理。
- **展示层（推荐）**：前端可以把同一条/同一批 `TerminalEntry` 渲染成接近 shell 终端的流水输出样式，供人类阅读；规范不要求底层直接存成一整段原始终端 dump。

### 2. Memory（记忆本文本）的改动

- 从“自由追加文本”收缩为**结构化记录**：每条至少包含 `userRequest` + `solutionSummary`，位于单独的 Memory 存储中（如 JSONL），不再混入 Trace。
- 写入时机从“每步都可以写”收缩为：**在子目标真正完成后，由 Loop 统一写一条总结记录**，并在 Trace 中追加一条 `kind: 'narrative'` 标记这次记忆更新。

### 3. Snapshot（快照）策略的改动

- 明确：**快照不再是每一步的默认动作**，而是完全由策略层通过 `shouldSnapshot(state)` / `Judge(milestone)` 决定。
- 明确：**Memory 追加本身不是触发快照的理由**；只有高风险操作或“可以用一句话描述、回滚有意义”的里程碑节点才考虑执行 `git commit + state 持久化`。
- 若某类记忆更新被视为里程碑，可在策略实现中手动绑定“记忆 + 快照”，但 Loop 骨架本身不内置任何“记忆即快照”的假设。

### 4. 每个 Agent 独立工作目录（Workspace）的改动

- 从“与 IDE 当前目录松散绑定”的隐式假设，改为：**每个逻辑 Agent 必须绑定一个稳定的工作目录 `workspaceRoot`**，形如：
  - `/projects/{agent-id}/`
  - 其中包含：源代码、`.agent/` 目录以及其他该 Agent 专属的运行产物。
- 同一 Agent 的不同会话，必须复用同一个 `workspaceRoot`，而不是每次新建临时目录。

### 5. 长期记忆与恢复（State / Trace / Terminal / Memory）的改动

- **State 持久化**：约定 `.agent/state.json` 为上次运行结束时的结构化状态快照（`goal/subgoals/currentSubgoal/mode/permissions/custom` 等），启动时优先尝试加载此文件以实现“续上之前断开的对话记忆”。
- **Trace / Terminal Log 复用**：`trace.jsonl` 与 `terminal.jsonl` 一律按追加写保存在 `.agent/` 下，跨 Session 共享；新一轮会话在原有日志基础上继续写，不清空。
- **Memory 独立文件**：新增显式的 Memory 存储（如 `.agent/memory.jsonl`），记录“用户请求 + 解决结论”的长期记忆，不与 Trace 混杂。
- **Collect 集成长期记忆**：在需要时，`Collect` 可以把 Memory 作为一个受控 source 注入上下文（带上 `coverage/reliability/by_source` 信息），但默认不把全部 Memory 一股脑塞进 prompt。

### 6. 会话与工作目录的绑定改动

- 新增一层轻量映射：**外部会话标识（如 chatId / conversationId） → `workspaceRoot`**。
  - 首次会话：根据用户目标创建/选择一个 `workspaceRoot`，写入 `.agent/state.json` 初始状态。
  - 后续会话：基于相同会话标识，直接定位到既有 `workspaceRoot`，从 `.agent/state.json` + Memory + 最近的 Trace `narrative` 中恢复上下文。
- Agent 的“记住我之前做过什么”能力，不再依赖外部系统的隐式上下文，而是显式依赖：
  - `workspaceRoot` 下的 `.agent/state.json`
  - `.agent/trace.jsonl` / `.agent/terminal.jsonl`
  - `.agent/memory.jsonl`（或等价的 Memory 存储）

