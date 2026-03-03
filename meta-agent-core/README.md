# Coding Agent 设计原则

> 非必要不复杂，追求简约

---

## 层次声明

本文档严格区分三个层次：

- **原则定义**：原语、边界、必须显式建模的概念——稳定不变。
- **默认实现**：`bash + git`、`bash + grep/ripgrep`、MCP、标签写入方式等——推荐实践，非唯一实现。
- **策略实现**：Mode 状态机、权限规则、快照时机等——可替换的注入逻辑，非核心。

**质量信号总规则：所有 `confidence` 和 `uncertainty` 统一写入 Trace。** 这是系统可调试性的基础，后文不再重复。

---

## 核心信念

> **复杂性本身是成本。** 只有在简单方案明显不够用时，才引入复杂性。
> **架构应当收敛，而非扩张。** 每一个可以被统一的概念，都应该被统一。
> **原语必须是原子的。** 能被其他原语组合实现的，不是原语，是约定或协议。
> **策略不是核心。** Mode 状态机、权限规则、快照时机是可替换的策略，不是不可变的原语。

---

## 心智模型：Agent 即"写书"过程

解决问题的过程，就是把一本书写好的过程。这本书就是 **agent 的推理轨迹**（Trace）——记录所有思考、工具调用、中间结果与质量信号。书是线性的，但可以在任意位置触发新的 LLM 调用来展开子问题，这个过程允许递归。

完整的 agent 运行时有五个不同性质的信息对象：

```
Trace          → 发生过什么（推理书：思考、判断、confidence、uncertainty）
Terminal Log   → 执行了什么（命令原文、stdout、stderr、退出码、耗时）
Memory         → 长期记忆（用户请求 + 解决结论，结构化记录，跨 Session）
State          → 现在是什么状态（结构化 KV：目标、子目标、当前模式、权限级别、版本号）
Workspace      → 外部世界的当前事实（优先读取可稳定复现的事实；运行时环境可靠性较低，
                 在 confidence.by_source 中显式标注）
```

Trace 和 Terminal Log 是两条独立的信息流，分别回答"为什么这样做"和"做了什么"。两者通过序号关联：Trace 里的 `exec` 条目携带对应 Terminal Log 条目的 `terminal_seq` 引用。

**"子 Agent"的本质与消解：** 所谓"子 agent"，无非是一次具备特殊 context 的 LLMCall。子 agent 作为独立运行时边界可以被消解——但 **Role/Mode 仍然是必要的控制边界**，不能被隐式地压进 `Collect` 配置里。

---

## 架构分层

按**职责稳定性**划分三层：

```
核心层（永远不变，接口冻结）
├── 四个执行原语
├── LLMCall（Reason / Judge）
├── Trace + Terminal Log（双流追加写）
└── 项目目录约定

编排层（框架稳定，策略可替换）
├── Loop 骨架（迭代结构 + 终止条件）
├── State 结构体（KV 容器，不内置业务逻辑）
└── Collect 协议（coverage/reliability 分离）

策略层（按需注入，可有多套实现）
├── Mode 状态机（切换规则）
├── 权限状态机（升级规则）
├── Harness 快照策略（何时快照，Milestone 判断）
├── Collect 检索策略（ripgrep / 向量索引 / 混合）
└── 错误分类策略（可重试 / 逻辑错误 / 环境错误 / 预算耗尽）
```

L0/L1/L2/L3 表达的是**推荐的策略包组合**，不是代码的硬性层级边界：

| 场景 | 启用的策略包 | 本文覆盖程度 |
|------|------------|------------|
| L0（最简运行） | 核心层 + 编排层骨架，所有 Hooks 为空 | ✅ 完整实现指导 |
| L1（标准场景） | + Mode 状态机 + 权限状态机 + Harness 标准策略 | ✅ 完整实现指导 |
| L2（复杂场景） | + 变更提案工作流 + 轻量并行 + MCP 适配 | ⚠️ 仅策略包描述，无实现指导 |
| L3（产品级）   | + 重隔离并行 + 语义索引 + 事件溯源 | ⚠️ 仅策略包描述，无实现指导 |

> **文档覆盖范围说明：** 本文档为 L0 和 L1 提供了完整的实现指导（数据结构定义、接口签名、状态机转移规则、Loop 骨架伪代码等）。L2 和 L3 仅描述了"启用哪些策略包"，未提供具体实现细节。如需实现 L2/L3 场景，需要补充以下内容：
> - **L2 变更提案工作流**：`LLMCall[Reason]` 生成 diff、多候选仲裁、与 `edit` 原语的衔接方式
> - **L2 轻量并行**：并行 `LLMCall[Reason]` 的调度机制、`Judge(selection)` 的 uncertainty 降权逻辑
> - **L2 MCP 适配**：能力端点的注册与调用协议、如何挂载到 Loop 骨架的 Hooks
> - **L3 重隔离并行**：独立 VM / Git worktree 的创建与销毁、多环境结果对比
> - **L3 语义索引**：嵌入向量的构建与更新时机、与 ripgrep 检索的混合策略
> - **L3 事件溯源**：State + Trace 升级为事件流的数据模型、确定性回放接口

**Loop 骨架通过 Hooks 与策略层解耦：**

```typescript
type LoopHooks = {
  onBeforeExec?:     (state, proposal) => Promise<'proceed' | 'block'>
  onAfterObserve?:   (state, result)   => Promise<'continue' | 'recover' | 'escalate'>
  onModeTransition?: (from, to)        => Promise<void>
  shouldSnapshot?:   (state)           => Promise<boolean>
  classifyError?:    (error)           => 'retryable' | 'logic' | 'environment' | 'budget'
  onInterrupt?:      (signal)          => Promise<UserDirective>
}
```

---

## 核心层

### 核心层 1：四个执行原语

接口永不修改：

| 原语 | 签名 | 职责 |
|------|------|------|
| read | `read(path) → content` | 读取文件/资源 |
| write | `write(path, content)` | 创建或覆写文件 |
| edit | `edit(path, old, new)` | 精确局部替换，`old` 须在文件中唯一匹配 |
| bash | `bash(command) → output` | 执行系统命令 |

**Core 保护：** `write` 和 `edit` 执行前校验目标路径，拒绝任何指向 Core 目录的写操作。Core 代码目录在运行时通过文件系统权限设为只读（双重保护）。Agent 唯一合法写入区域是 Workspace（项目目录）和 `.agent/` 目录。

### 核心层 2：推理引擎 LLMCall

```
LLMCall(context, input) → { result, uncertainty{score, reasons} }
```

两种模式：

- **Reason**：生成提案、写代码、制定计划。不确定性高时应生成多候选而非单一提案。
- **Judge(type)**：收敛裁决，`type ∈ {outcome, risk, selection, milestone, capability}`。不确定性高时应 Escalate 而非执行。每次 Judge 调用必须显式指定 type。

> outcome = 是否达成子目标；risk = 是否允许执行/权限是否满足；selection = 多候选方案中选哪一个；milestone = 当前完成点是否值得 git commit；capability = 任务是否在 agent 能力和权限范围内（启动时能力边界声明）。

### 核心层 3：双流日志（Trace + Terminal Log）

```typescript
// Trace：推理书——记录"为什么"
type TraceEntry = {
  ts: number;
  seq: number;                 // 全局序号
  kind: 'collect' | 'reason' | 'judge' | 'exec' | 'observe' |
        'state' | 'escalate' | 'stop' | 'interrupt' | 'narrative';
  data: unknown;
  confidence?: Confidence;     // Collect 产出
  uncertainty?: Uncertainty;   // LLMCall 产出
  terminal_seq?: number;       // 关联的 Terminal Log 序号（exec 类型时填写）
  tags?: string[];
  // 扩展字段：补齐 change.md 要求的字段
  judge_type?: string;   // Judge 调用的类型：outcome, risk, selection, milestone, capability
  operation?: string;   // 原子操作类型：read, write, edit, bash
  input?: string;       // 输入内容
  output?: string;      // 输出内容
  durationMs?: number; // 耗时
};

// Terminal Log：终端——记录所有原子操作及其结果
type TerminalEntry = {
  ts: number;
  seq: number;                 // 全局序号，与 Trace.terminal_seq 对应
  operation: 'llmcall' | 'collect' | 'read' | 'write' | 'edit' | 'bash';
  input?: string;              // 输入内容（路径、prompt 等）
  output: string;              // 操作结果（超出 100KB 时截断并标记）
  command?: string;            // 原始命令（bash 专用）
  exitCode?: number;           // 退出码（bash 专用）
  durationMs?: number;
  truncated?: boolean;
};
```

**统一 seq 序号空间：** Trace 和 Terminal Log 共享同一个全局递增序号，由 Agent Core 统一分配，写入时同步。Trace 的 `exec` 类型条目携带 `terminal_seq` 指向对应 Terminal Log 条目，实现双向可达。

两者均为追加写，跨 Session 累积，不清空。`narrative` 类型的 Trace 条目是人类可读的状态摘要，在 Mode 切换和 Milestone 完成时由轻量 LLMCall[Reason] 生成。

**双格式日志：**
- `trace.jsonl`：JSON 格式，用于程序解析
- `terminal.md`：Markdown 格式，用于人类阅读。支持路径别名、操作图标（📖 read · ✏️ write · 🔧 edit · 💻 bash · 🔍 collect · 🤖 llmcall）、折叠块、截断引用等功能。

  **Markdown 渲染规则：**

  1. 表格前后必须有空行
  2. 表格必须有分隔符行（`|---|---|`）
  3. 表格单元格只放单行纯文本，截断用省略号
  4. 多行内容、含 Markdown 语法的内容全部放进 `<details>` 块
  5. `</details>` 后必须有空行，再写下一个 `##` 标题

**输出截断：** 超过阈值时自动截断并标记。默认阈值 100KB，可通过 AGENT.md 的 `maxOutputLength` 配置（单位：字节）。

### 核心层 4：项目目录约定

每次运行绑定一个项目目录，支持跨 Session 恢复：

```
/projects/{project-id}/
├── .agent/
│   ├── AGENT.md              # 静态上下文（从根目录移入）
│   ├── state.json            # 上次运行结束时的 State 快照（Session 恢复入口）
│   ├── trace.jsonl           # 累积推理轨迹（追加写，跨 Session）
│   ├── terminal.md           # 累积终端日志（追加写，跨 Session，Markdown 格式）
│   ├── memory.jsonl          # 长期记忆（追加写，跨 Session）
│   └── sessions/             # 每次运行的摘要索引（便于历史检索）
└── [项目源代码]
```

`.agent/` 目录加入 `.gitignore`，不受 git 管理。

**Session 恢复：** 启动时检测 `.agent/state.json` 是否存在：
- 存在 → 恢复 State，从上次的 `currentSubgoal` 继续，Trace / Terminal Log / Memory 追加写
- 不存在 → 全新初始化，创建 `.agent/` 目录结构

**HTTP API Session 恢复：** 通过 Agent 缓存（按 `workDir` 索引）实现跨 HTTP 请求 Session 保持。同一 `workDir` 的多次 `/run` 请求共享同一 Agent 实例；支持 `resume=true/false` 参数控制。序列号跨请求连续递增。

### 核心层 5：Memory 长期记忆

> Memory 与 State 的分工：State 记录"现在"（当前任务的实时快照，随迭代覆写），Memory 记录"历史"（跨任务的档案，只增不改）。当前任务内已完成的子目标存入 `State.archivedSubgoals`，供当前任务后续步骤参考；任务终止时，将完整的子目标列表随任务总结一并写入 Memory，供未来任务检索。两者不合并，原因是生命周期不同（快照 vs 档案）、读写模式不同（整体加载 vs 按需检索）、增长方式不同（有界 vs 无界）。

```
type SubgoalOutcome = 'completed' | 'voided';

type Subgoal = {
  goal: string;
  summary: string;
  outcome: SubgoalOutcome;
};

MemoryEntry = {
  ts: number;
  sessionId?: string;
  userRequest: string;           // 用户原始请求
  solutionSummary: string;       // 任务整体总结
  subgoals: Array<{             // 子目标明细
    goal: string;
    summary: string;
    outcome: SubgoalOutcome;
  }>
}
```

专门存储"用户请求 + 解决结论"的结构化记录，与 Trace 分开维护：

- **写入时机**：任务开始时记录 `userRequest`（`solutionSummary` 暂填占位符）；任务终止时更新 `solutionSummary`
- **检索接口**：`search(query)` 按关键词检索，`recent(n)` 获取最近 N 条
- **Collect 集成**：`Collect` 可将 Memory 作为受控 source 注入上下文（附带 `coverage/reliability/by_source`）

### 核心层 6：上下文编排协议 Collect

```
Collect(sources, filters, limits) → { context, confidence{coverage, reliability, gaps, by_source} }
```

`Collect` 是**编排协议**，不是原语。`coverage`（信息充分性）与 `reliability`（信息可信度）必须分开：

```
coverage 高，reliability 高  → LLMCall[Reason]
coverage 低，reliability 高  → 补充采集（再次 Collect，≤N 次）
coverage 高，reliability 低  → 刷新来源或 Escalate
coverage 低，reliability 低  → 直接 Escalate
```

**支持的 Source 类型：**

| 类型 | 说明 |
|------|------|
| file | 读取指定文件 |
| bash | 执行 shell 命令并获取输出 |
| trace_tag | 按标签过滤 Trace 历史 |
| skills | 从 `skills/` 目录检索技能文档（解析到 `skills/{query}/SKILL.md`，每个 skill 可包含独立脚本和资源） |

`limits` 中包含 token 预算约束：优先保留最近交互和 State，对已归档子目标的旧 Trace 做摘要压缩。

### 核心层 7：核心执行循环骨架

```
┌──────────────────────────────────────────────────────────────────┐
│  [Interrupt 检查点] ← 每次迭代开始时轮询，迭代边界安全触发         │
│                                                                  │
│  0. 能力边界声明（首次运行）                                      │
│     LLMCall[Judge(capability)] → 完全可行 / 部分可行 / 不可行     │
│                                                                  │
│  1. Collect → { context, confidence }                            │
│       ↓ 高置信度  ↓ 中（补采集，≤N次）  ↓ 低→Escalate            │
│  2. LLMCall[Reason] → { proposal, uncertainty }                  │
│       ↓ 低不确定性         ↓ 高→多候选或 Escalate                 │
│  3. [Dry-run 验证]（高风险操作）                                  │
│  4. Hook: onBeforeExec → proceed / block                         │
│  5. 执行工具 [Harness 策略决定是否快照]                           │
│     → Terminal Log 记录命令 + 输出                                │
│  6. Observe：读取真实结果                                         │
│  7. Hook: onAfterObserve → continue / recover / escalate         │
│  8. LLMCall[Judge(outcome)] → { verdict, uncertainty }           │
│       ↓ 达成且不确定性低   ↓ 未达成或不确定性高→Recovery          │
│  9. LLMCall[Judge(milestone)] → 是否提交 git                     │
│  10. Update State，写入 narrative 摘要                            │
│  11. Continue / Escalate / Stop                                  │
│      ├── 目标已完成 → Stop                                       │
│      ├── 连续无增益 → Escalate                                   │
│      ├── 超出预算 → Stop                                         │
│      └── 否则 → Continue                                         │
└──────────────────────────────────────────────────────────────────┘
```

终止条件是一等概念，不是循环的附属品。

---

## 编排层

### State 结构体

State 是 KV 容器，不内置业务逻辑：

```typescript
type SubgoalOutcome = 'completed' | 'voided';

type ArchivedSubgoal = {
  goal: string;
  summary: string;           // 该子目标的解决结论
  outcome: SubgoalOutcome;  // voided = 被 Recovery 回滚，此路不通
};

type AgentState = {
  goal: string;
  subgoals: string[];
  currentSubgoal: string | null;
  archivedSubgoals: ArchivedSubgoal[];  // 已完成子目标，包含结论和结果
  mode: Mode;
  permissions: PermissionLevel;
  iterationCount: number;
  noProgressCount: number;
  version: number;
  custom: Record<string, unknown>;
};
```

### Harness 约定（骨架）

三条硬性规则：
1. **快照失败默认阻断副作用执行**（降级模式需显式声明并记录到 Trace）
2. **只对可能产生持久副作用的操作快照**（只读的 `bash ls` 等不需要）
3. **快照时机由 `shouldSnapshot` Hook 决定**，非每步自动触发

git 管理严格限制在项目源代码目录，排除 `.agent/`。

### 静态上下文注入（AGENT.md）

Session 启动时自动读取 `{workDir}/.agent/AGENT.md`（根据 change.md 修改，AGENT.md 已移至 .agent/ 目录），注入每次 LLM 调用的 system prompt，提交到 git，团队共享。

**AGENT.md 运行时配置格式：**

所有运行时配置均写在 md 文件里的 ```json 代码块中：

```json
{
  "maxOutputLength": 204800,
  "strategies": {
    "level": "L1",
    "permissions": 3,
    "mode_fsm": "enabled",
    "permission_fsm": "enabled",
    "harness": "standard",
    "error_classifier": "enabled",
    "judge": {
      "outcome": "required",
      "risk": "enabled",
      "milestone": "enabled",
      "capability": "enabled",
      "selection": "disabled"
    }
  }
}
```

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| maxOutputLength | Terminal Log 输出截断长度（字节） | 102400 (100KB) |
| strategies.level | 基础策略包，决定默认启用范围 | L1 |
| strategies.permissions | 初始权限级别（0-4），定义 Agent 可执行的操作范围 | 2 |
| strategies.mode_fsm | Mode 状态机（Plan/Execute/Review/Recovery/Paused） | enabled |
| strategies.permission_fsm | 权限状态机（Level 0-4） | enabled |
| strategies.harness | 快照策略 | standard |
| strategies.error_classifier | 错误分类（retryable / logic / environment / budget） | enabled |
| strategies.judge.outcome | Loop 终止收敛（不可关闭，可降级为 rule_based） | required |
| strategies.judge.risk | 高权限操作门卫 | enabled |
| strategies.judge.milestone | git commit 时机 | enabled |
| strategies.judge.capability | 启动时能力边界声明 | enabled |
| strategies.judge.selection | 多候选仲裁 | disabled |

**权限级别说明：**

| 级别 | 名称 | 允许的操作 |
|------|------|-----------|
| 0 | 只读 | read |
| 1 | 受控写 | write/edit（限工作区） |
| 2 | 受控执行 | bash（常规命令，无网络/删除） |
| 3 | 高风险执行 | bash（网络、删除、系统级变更） |
| 4 | 自主模式 | 预授权范围内自动执行 |

说明：
- `judge.outcome` 是唯一不建议 `disabled` 的项，降级选项是 `rule_based`（规则匹配替代 LLMCall）
- `level: L0` 时所有策略项默认 `disabled`，仅运行核心层 + 编排层骨架
- SDK 解析配置时优先使用 ```json 代码块中的内容，同时向后兼容 YAML 格式

---

## 策略层

### 策略 1：Mode 状态机

存储在 `State.mode`，每次切换记录到 Trace 并生成 `narrative` 摘要：

```
Plan 模式      只读 + LLMCall[Reason]，不触发有副作用的工具
Execute 模式   完整工具访问，执行已批准的动作
Review 模式    只读 + LLMCall[Judge(outcome)]，检查不生成
Recovery 模式  只允许 bash(git) 和 read，专注诊断与回退
Paused 模式    Interrupt 触发后进入，等待用户交互
```

**切换规则：**

```
Plan    → Execute   方案通过 Judge(risk)，且权限满足
Execute → Review    当前批次动作完成
Review  → Execute   Judge(outcome) 通过，且仍有剩余子目标
Review  → Plan      目标变化，或需重新规划
任意    → Recovery  连续失败 / 结果冲突 / 快照失败 / 回滚触发
任意    → Paused    Interrupt 信号到达（迭代边界安全触发）
Paused  → Plan      用户修改目标或补充信息后继续
Paused  → Stop      用户终止任务
任意    → Plan      上下文重大变化（用户补充信息、外部状态突变）
```

### 策略 2：权限状态机

存储在 `State.permissions`，升级需显式申请，不隐式提升：

```
Level 0  只读          read
Level 1  受控写        write / edit（限工作区）
Level 2  受控执行      bash（常规，无网络/删除）
Level 3  高风险执行    bash（网络、删除、系统级变更）
Level 4  自主模式      预授权范围内自动执行
```

即使在 Level 4，不可逆的破坏性操作仍应经过 `onBeforeExec` Hook 二次确认。

### 策略 3：Milestone 快照策略

`shouldSnapshot` Hook 调用 `LLMCall[Judge(milestone)]`，判断标准：
- 当前完成点是否可以用一句话独立描述（功能完整性）
- 回滚到此处是否有意义（可恢复性）
- 与上次快照之间是否有实质变更

判断为"是"时执行 `bash git commit -m "[milestone] {描述}"`。

### 策略 4：错误分类策略

`classifyError` Hook 在进入 Recovery 之前先判断错误性质：

```
可重试错误    → 网络超时、文件锁、临时资源不足 → 直接重试，不进 Recovery，不回滚
逻辑错误      → 方案本身有问题               → 进 Recovery，回滚，重新 Plan
环境错误      → 依赖缺失、权限不足            → Escalate，人工介入
预算耗尽      → token/时间/操作次数超限        → Stop，不是 Recovery
```

### 策略 5：用户打断机制（Interrupt）

Interrupt 是一等概念，不是 Escalate 的子集。Loop 在每次迭代开始时轮询 `InterruptChannel`：

```typescript
const interrupt = await interruptChannel.poll();
if (interrupt) {
  await harness.snapshot(`interrupt-iter-${state.iterationCount}`);
  state.mode = 'paused';
  trace.append({ kind: 'interrupt', data: { userMessage: interrupt.message } });
  const directive = await hooks.onInterrupt?.(interrupt);
  applyUserDirective(directive, state);
}
```

用户在 Paused 模式下看到的第一条信息是最近的 `narrative` 摘要。用户每条输入记录到 Trace，形成完整人机协作轨迹。

### 策略 6：Collect 检索策略

```
精确检索（优先）   bash ripgrep/grep 正则
语义检索（补充）   向量索引（仅在正则明显不足时，L2/L3 场景）
```

---

## 工程补充

### E1：Agent Core 保护

`write` 和 `edit` 内置路径白名单，Core 目录文件系统权限只读，形成双重保护。

### E2：Dry-run 验证层

高风险操作在执行前预演：
- 文件操作：先在临时目录执行，确认符合预期再写入真实路径
- bash 命令：优先使用 `--dry-run` 标志（如 `rsync`、`terraform`）
- 代码修改：在内存中模拟 `edit` 操作，验证 `old` 唯一匹配

Dry-run 结果写入 Terminal Log，标记 `dry_run: true`。

### E3：能力边界声明（启动时早期失败）

读取 AGENT.md 之后、进入 Plan 之前，执行一次能力评估：

```
LLMCall[Judge(capability)](目标描述 + 权限级别 + 环境信息)
→ 完全可行    → 进入正常 Plan
→ 部分可行    → 拆解子目标，明确哪些需要升级权限或人工协助，用户确认后继续
→ 不可行      → 立即 Stop，给出原因
```

### E4：Context 健康度维护

- 已完成子目标的详细推理轨迹摘要压缩后写入 `archivedSubgoals`，不再进入 active Collect
- 被 Recovery 回滚的提案在 Trace 中显式标记 `status: 'voided'`，Collect 过滤时跳过
- 每次 Session 恢复时，对上次运行的 Trace 做一次健康度检查，清理过时标记

### E5：多 Agent 协作最小接口

```
共享 Workspace     同一项目目录，通过文件系统协作
共享 Trace         追加写，通过 trace_tag 区分 agent 来源
子目标所有权标记   写入 State.custom，防止冲突写入
```

不需要消息队列，不需要 RPC。文件系统 + git + 标签足够。

---

## 原语与组合关系全图

```
核心层（接口冻结，永不修改）
├── LLMCall(context, input) → { result, uncertainty }
│   ├── Reason：发散生成
│   └── Judge(type)：收敛裁决
│       type ∈ {outcome, risk, selection, milestone, capability}
├── read(path) → content
├── write(path, content)       ← 路径白名单保护 Core
├── edit(path, old, new)       ← 路径白名单保护 Core
├── bash(command) → output     → Terminal Log 自动记录
└── Trace + Terminal Log       ← 双流追加写，互相引用

编排层（框架稳定）
├── Collect(...)               → { context, confidence }
├── Loop 骨架                  ← Hooks 注入点
└── State 结构体               ← KV 容器

策略层（可替换实现，通过 Hooks 注入）
├── Mode 状态机               = State.mode + 切换规则 + Paused 模式
├── 权限状态机                = State.permissions + 升级规则
├── Milestone 快照            = Judge(milestone) + bash git commit
├── 错误分类                  = classifyError Hook
├── Interrupt 机制            = InterruptChannel + onInterrupt Hook
└── Collect 检索策略          = ripgrep / 向量 / 混合

由原语组合实现的能力（不是新原语）
├── 标签检索    = write（标签）+ bash grep + Collect 过滤
├── 版本快照    = bash git commit [Milestone 策略触发]
├── 版本回退    = bash git checkout [Judge 或用户触发]
├── 代码搜索    = Collect 内调用 bash ripgrep
├── 上下文压缩  = LLMCall[Reason]（摘要）+ write（写回）
├── 子 agent   = Collect（特定配置）+ LLMCall（特定 prompt）
├── 变更提案    = LLMCall[Reason]（生成 diff）+ 多次 edit + Dry-run
├── 轻量并行    = parallel LLMCall[Reason] + LLMCall[Judge(selection)]
└── 自我描述    = LLMCall[Reason]（narrative）+ Trace.narrative 条目

外部能力适配（不改变原语集合）
└── MCP：插件化外设（L2 场景）
```

---

## 质量追踪链

```
Collect.confidence              LLMCall.uncertainty
─────────────────               ───────────────────
coverage:    信息充分性           score:   输出可靠性的反面
reliability: 信息可信度           reasons: 不确定的具体原因
gaps:        缺少什么
by_source:   哪个来源有问题
        │                                │
        └──────── 全部写入 Trace ─────────┘
                        │
            人类专家的 debug 入口：
            "信息不足导致推理不稳" vs
            "信息充足但模型仍不确定"（任务超出能力边界）

Terminal Log（独立信息流，记录所有原子操作）
────────────────────────────────────────────
operation / input / output / command / exitCode / durationMs / truncated
        ↕ 通过 terminal_seq 关联 Trace.exec 条目
```

---

## 案例：Survey Agent 的 Workflow 驱动设计

以下以 Survey Agent 为例，说明如何把业务 workflow 放入 AGENT.md，而让运行时容器只做薄封装。

### 背景

Survey Agent 是一种自动化学术文献检索与知识管理系统，需要执行以下三个阶段的流水线：
1. **Fetcher**：从 arXiv 抓取论文
2. **Screener**：基于用户配置和知识库筛选论文
3. **Analyst**：分析论文并写入知识库

### 传统实现方式

传统的做法是将 workflow 硬编码在 Python 源码中（如 pipeline.py）：

```python
# 传统方式：Python 代码控制 workflow
def run_pipeline():
    # Stage 1: Fetcher
    fetch_papers()
    # Stage 2: Screener
    screen_papers()
    # Stage 3: Analyst
    analyze_papers()
```

**问题**：业务逻辑修改需要改 Python 代码，不够灵活。

### 推荐实现方式：AGENT.md + Skills 驱动

将 workflow 定义在 `.agent/AGENT.md` 中，Python 只做薄封装：

#### 1. AGENT.md 定义 Workflow

在 AGENT.md 中添加 Survey Workflow 章节，描述：
- 三个阶段的总览
- 每个阶段的配置来源（引用 SKILL.md）
- 输入输出约定
- 目录与文件命名规范

```markdown
## Survey Workflow

### Fetcher 阶段
- 参考 skills/arxiv_api/SKILL.md
- 输出: data/raw_papers_{YYYY-MM-DD}.json

### Screener 阶段
- 参考 skills/screening/SKILL.md
- 输出: data/selected_papers_{YYYY-MM-DD}.json

### Analyst 阶段
- 参考 skills/writing/SKILL.md
- 输出: knowledge_base/{topic}/paper_{arxiv_id}.md
```

#### 2. Skills 定义可组合能力单元

每个 Skill 独立定义：
- 技能用途
- 输入/输出格式
- 命令行及 Python 调用方式
- 与其他技能的衔接说明

```
skills/
├── arxiv_api/
│   ├── SKILL.md        # 技能说明
│   └── fetch_arxiv.py  # 实现脚本
├── screening/
│   ├── SKILL.md
│   └── screen_papers.py
├── writing/
│   └── SKILL.md
└── pdf_extract/
    ├── SKILL.md
    └── extract_text.py
```

#### 3. Python 薄封装

Python 代码（api_server.py）只提供：
- HTTP API 接口
- 调用 SDK 的胶水逻辑
- 目录结构初始化

```python
# 薄封装：只构造 goal 和 sources，让 Agent 自行推理
def run_pipeline_thread():
    goal = "执行一次完整的 Survey Workflow..."
    
    sources = [
        {"type": "file", "query": ".agent/AGENT.md"},
        {"type": "skills", "query": "arxiv_api"},
        {"type": "skills", "query": "screening"},
        {"type": "skills", "query": "writing"},
    ]
    
    sdk.run(goal=goal, workDir=..., collectConfig={"sources": sources})
```

### 设计原则

1. **Workflow 驱动**：具体的工作流程通过 AGENT.md + skills 文档定义，而不是硬编码在 Python 代码中
2. **Skills 作为可组合能力单元**：每个 Skill 独立定义职责，通过 CollectConfig 组合使用
3. **Python 薄封装**：Python 代码只提供运行时容器、API 接口和少量胶水逻辑
4. **修改优先序**：业务逻辑修改应优先改 AGENT.md 和 skills，而不是改 Python 源码

### 优势

- **灵活性**：修改 workflow 不需要改 Python 代码
- **可读性**：AGENT.md 清晰描述了整体架构
- **可测试性**：每个 Skill 可以独立测试
- **可扩展性**：新增 Skill 只需要在 AGENT.md 中引用

---

## 系统健康信号

| 指标 | 异常信号 | 指向的问题 |
|------|---------|-----------|
| Escalate 率 | 持续偏高 | confidence 阈值过严，或信息来源长期不足 |
| 无效循环率 | Judge 反复判定无增益 | Reason 的 uncertainty 持续偏高，任务分解粒度过粗 |
| Judge uncertainty | 持续偏高 | context 质量差，或裁决目标描述模糊 |
| Recovery 率 | 偏高但 Escalate 率低 | 错误分类策略未区分可重试错误，导致不必要回滚 |
| Milestone 密度 | 极低 | 任务分解粒度过粗，或 Milestone 判断阈值过严 |
| Interrupt 后恢复率 | 低 | narrative 摘要质量差，用户无法理解当前状态 |

---

## 永远不要做的事

**原语层：**
- **修改四个执行原语的接口签名**：永不修改。
- **让原语写入 Core 目录**：`write` 和 `edit` 必须有路径白名单。
- **把 `Collect` 当原语**：它是编排协议，叫它原语会让复杂性变成黑箱。
- **把 MCP 称为新执行原语**：它是适配层，否则原语会无限膨胀。

**编排层：**
- **只维护 Trace，不维护 State**：从日志反推状态既低效又不稳。
- **不定义终止条件**："停不下来"是 agent 系统最常见的故障。
- **在 Loop 骨架里内置策略逻辑**：策略通过 Hooks 注入，Loop 骨架不感知具体策略。
- **Trace 和 Terminal Log 混合**：两条信息流职责不同，混合后两个目的都达不到。

**策略层：**
- **让 Judge 承担模糊职责**：每次 Judge 调用必须显式指定 `type`。
- **没有切换规则的 Mode**：状态机转移表缺失时，Mode 只是标签。
- **把所有错误都走 Recovery**：可重试错误直接重试，不回滚。
- **git 管理 `.agent/` 目录**：Trace 和 Terminal Log 是追加写日志，不需要版本管理。
- **在循环中途打断 LLMCall**：Interrupt 只在迭代边界触发，不破坏原子操作。
- **厂商锁定**：`LLMCall` 实现层保持可替换。

---

## 一句话总结

> Agent 的最小闭环是：Collect 形成足够可信的上下文，LLMCall 产出提案与不确定性，Judge 决定是否执行，执行后观察结果并更新状态，直到 Continue / Escalate / Stop——所有这一切发生在受保护的项目目录里，推理写入 Trace，执行写入 Terminal Log，策略通过 Hooks 注入，用户可以在任意迭代边界打断介入。
