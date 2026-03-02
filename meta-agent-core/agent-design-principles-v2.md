# Coding Agent 设计原则分级指南 v2

> 视角：非必要不复杂，追求简约
> 本版本在 v1 基础上，整合了五个工程补充、六个健壮性补充、以及分层解耦方案的讨论结论。

---

## 声明：三种层次的区分

本文档严格区分三个层次：

- **原则定义**：什么是原语，什么是边界，什么必须显式建模——这些是稳定的。
- **默认实现**：`bash + git`、`bash + grep/ripgrep`、MCP、标签写入方式等——推荐实践，不是唯一正确实现。
- **策略实现**：Mode 状态机、权限规则、快照时机等——可替换的注入逻辑，不是核心。

**质量信号总规则：所有 `confidence` 和 `uncertainty` 统一写入 Trace。** 这是系统可调试性的基础，后文不再重复。

---

## 核心心智模型：Agent 即"写书"过程

解决问题的过程，就是把一本书写好的过程。这本书就是 **agent 的推理轨迹**（Trace）——记录所有思考、工具调用、中间结果与质量信号。书是线性的，但可以在任意位置触发新的 LLM 调用来展开子问题，这个过程允许递归。

Trace 只是推理日志，不等于全部状态。完整的 agent 运行时有**四个**不同性质的信息对象：

```
Trace          → 发生过什么（推理书：思考、判断、confidence、uncertainty）
Terminal Log   → 执行了什么（终端：命令原文、stdout、stderr、退出码、耗时）
State          → 现在是什么状态（结构化 KV：目标、子目标、当前模式、权限级别、版本号）
Workspace      → 外部世界的当前事实（优先读取可稳定复现的事实；运行时环境按需读取，
                 可靠性较低，在 confidence.by_source 中显式标注）
```

Trace 和 Terminal Log 是两条独立的信息流，分别回答"为什么这样做"和"做了什么"。两者通过序号关联：Trace 里的 `exec` 条目携带对应 Terminal Log 条目的 `seq` 引用，形成可追溯链。

**"子 Agent"的本质与消解：** 所谓"子 agent"，无非是一次具备特殊 context 的 LLMCall。不同 agent 之间的差异归根结底只是 context 不同，因此子 agent 作为独立运行时边界可以被消解——但 **Role/Mode 仍然是必要的控制边界**，不能被隐式地压进 `Collect` 配置里。

---

## 核心信念

> **复杂性本身是成本。** 只有在简单方案明显不够用时，才引入复杂性。
> **架构应当收敛，而非扩张。** 每一个可以被统一的概念，都应该被统一。
> **原语必须是原子的。** 能被其他原语组合实现的，不是原语，是约定或协议。
> **策略不是核心。** Mode 状态机、权限规则、快照时机是可替换的策略，不是不可变的原语。

---

## 分层重新定义：三层而非四层

v1 按"必要性"划分 L0/L1/L2/L3，但代码天然按"依赖关系"组织，两个维度不一致导致层间耦合。

v2 改为按**职责稳定性**划分三层：

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

**Loop 骨架通过钩子（Hooks）与策略层解耦：**

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

L0/L1/L2/L3 的概念继续保留，但现在它们表达的是**推荐的策略包组合**，而非代码的硬性层级边界：

| 场景标签 | 启用的策略包 |
|---------|------------|
| L0（最简运行） | 核心层 + 编排层骨架，所有 Hooks 为空 |
| L1（标准场景） | + Mode 状态机 + 权限状态机 + Harness 标准策略 |
| L2（复杂场景） | + 变更提案工作流 + 轻量并行 + MCP 适配 |
| L3（产品级）   | + 重隔离并行 + 语义索引 + 事件溯源 |

---

## 核心层：所有 Agent 必须具备

### 核心层 1：四个执行原语

接口定义稳定不变，永不修改：

| 原语 | 签名 | 职责 |
|------|------|------|
| read | `read(path) → content` | 读取文件/资源 |
| write | `write(path, content)` | 创建或覆写文件 |
| edit | `edit(path, old, new)` | 精确局部替换，`old` 须在文件中唯一匹配 |
| bash | `bash(command) → output` | 执行系统命令 |

**原语的路径白名单约束（Core 保护）：** `write` 和 `edit` 原语在执行前校验目标路径，拒绝任何指向 Core 目录的写操作。Core 代码目录在运行时通过文件系统权限设为只读，形成双重保护。Agent 唯一合法写入的区域是 Workspace（项目目录）和 `.agent/` 目录（推理日志）。

### 核心层 2：推理引擎 LLMCall

```
LLMCall(context, input) → { result, uncertainty{score, reasons} }
```

两种模式：

- **Reason**：生成提案、写代码、制定计划。不确定性高时应生成多候选而非单一提案。
- **Judge(type)**：收敛裁决，`type ∈ {outcome, risk, selection, milestone, capability}`。不确定性高时应 Escalate 而非执行。每次 Judge 调用必须显式指定 type。[^judge]

[^judge]: outcome = 是否达成子目标；risk = 是否允许执行/权限是否满足；selection = 多候选方案中选哪一个；milestone = 当前完成点是否值得一个 git commit；capability = 任务是否在 agent 能力和权限范围内（用于启动时的能力边界声明）。

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
};

// Terminal Log：终端——记录"做了什么"
type TerminalEntry = {
  ts: number;
  seq: number;                 // 全局序号，与 Trace.terminal_seq 对应
  command: string;             // 原始命令
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
};
```

两者均为追加写，跨 Session 累积，不清空。`narrative` 类型的 Trace 条目是人类可读的状态摘要，在 Mode 切换和 Milestone 完成时由轻量 LLMCall[Reason] 生成——这是 agent 自我描述能力的基础。

### 核心层 4：项目目录约定

每次运行绑定一个项目目录，支持跨 Session 恢复：

```
/projects/{project-id}/
├── .agent/
│   ├── state.json          # 上次运行结束时的 State 快照（Session 恢复入口）
│   ├── trace.jsonl         # 累积的推理轨迹（追加写，跨 Session）
│   ├── terminal.jsonl      # 累积的终端日志（追加写，跨 Session）
│   └── sessions/           # 每次运行的摘要索引（便于历史检索）
├── AGENTS.md               # 静态上下文（提交到 Git，团队共享）
└── [项目源代码]
```

`.agent/` 目录加入项目的 `.gitignore`，由自身的追加写机制管理，不受 git 管理。

**Session 恢复逻辑：** 启动时检测 `.agent/state.json` 是否存在：
- 存在 → 恢复 State，从上次的 `currentSubgoal` 继续，Trace 和 Terminal Log 追加写
- 不存在 → 全新初始化，创建 `.agent/` 目录结构

### 核心层 5：上下文编排协议 Collect

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

### 核心层 6：核心执行循环骨架

```
┌──────────────────────────────────────────────────────────────────┐
│  [Interrupt 检查点] ← 每次迭代开始时轮询，安全打断位置           │
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

## 编排层：框架稳定，策略可替换

### 编排层 1：State 结构体

State 是 KV 容器，不内置业务逻辑。业务逻辑（Mode 切换规则、权限升级规则）由策略层通过 Hooks 注入：

```typescript
type AgentState = {
  goal: string;
  subgoals: string[];
  currentSubgoal: string | null;
  archivedSubgoals: string[];     // 已完成子目标，不再进入 active context
  mode: Mode;
  permissions: PermissionLevel;
  iterationCount: number;
  noProgressCount: number;
  version: number;
  custom: Record<string, unknown>;
};
```

### 编排层 2：Harness 约定（骨架）

三条硬性规则：
1. **快照失败默认阻断副作用执行**（降级模式需显式声明并记录到 Trace）
2. **只对可能产生持久副作用的操作快照**（只读的 `bash ls` 等不需要）
3. **快照时机由 `shouldSnapshot` Hook 决定**，而非每步自动触发

git 管理作用域严格限制在项目源代码目录，排除 `.agent/` 目录。

### 编排层 3：静态上下文注入（AGENTS.md）

纯文本文件，Session 启动时自动读取，提交到 git，团队共享。是最可靠、最可调试的长期记忆基础形式。

---

## 策略层：按需注入，可有多套实现

### 策略 1：Mode 状态机（标准实现）

存储在 `State.mode`，每次切换记录到 Trace 并生成 `narrative` 摘要。没有切换规则的 Mode 只是标签，不是控制机制：

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

### 策略 2：权限状态机（标准实现）

存储在 `State.permissions`，分五级，升级需显式申请，不隐式提升：

```
Level 0  只读          read
Level 1  受控写        write / edit（限工作区）
Level 2  受控执行      bash（常规，无网络/删除）
Level 3  高风险执行    bash（网络、删除、系统级变更）
Level 4  自主模式      预授权范围内自动执行
```

即使在 Level 4，不可逆的破坏性操作仍应经过 `onBeforeExec` Hook 二次确认。

### 策略 3：Milestone 快照策略（标准实现）

`shouldSnapshot` Hook 的标准实现调用 `LLMCall[Judge(milestone)]`，判断标准：
- 当前完成点是否可以用一句话独立描述（功能完整性）
- 回滚到此处是否有意义（可恢复性）
- 与上次快照之间是否有实质变更

判断为"是"时执行 `bash git commit -m "[milestone] {描述}"`，判断为"否"时继续不提交。

### 策略 4：错误分类策略（标准实现）

`classifyError` Hook 的标准实现，在进入 Recovery 之前先判断错误性质：

```
可重试错误    → 网络超时、文件锁、临时资源不足 → 直接重试，不进 Recovery，不回滚
逻辑错误      → 方案本身有问题               → 进 Recovery，回滚，重新 Plan
环境错误      → 依赖缺失、权限不足            → Escalate，人工介入
预算耗尽      → token/时间/操作次数超限        → Stop，不是 Recovery
```

把四类错误混在一起走同一条路，会导致大量不必要的回滚和重新规划。

### 策略 5：用户打断机制（Interrupt）

Interrupt 是一等概念，不是 Escalate 的子集。Loop 在每次迭代开始时轮询 `InterruptChannel`：

```typescript
// 轮询位置：迭代边界（原子操作完成后，下一操作开始前）
const interrupt = await interruptChannel.poll();
if (interrupt) {
  // 先快照保护现场
  await harness.snapshot(`interrupt-iter-${state.iterationCount}`);
  state.mode = 'paused';
  trace.append({ kind: 'interrupt', data: { userMessage: interrupt.message } });

  // 开启交互，等待用户指令
  const directive = await hooks.onInterrupt?.(interrupt);

  // 用户可以：修改 goal、补充信息、回退到某个 milestone、终止任务
  applyUserDirective(directive, state);
}
```

用户在 Paused 模式下看到的第一条信息是最近的 `narrative` 摘要，而不是原始 JSON State。用户的每条输入记录到 Trace，形成完整的人机协作轨迹。

### 策略 6：Collect 检索策略

代码搜索优先使用 `bash` + ripgrep/grep，这是 `Collect` 内部的检索层实现，不是新原语：

```
精确检索（优先）   bash ripgrep/grep 正则
语义检索（补充）   向量索引（仅在正则明显不足时，L2/L3 场景）
```

`Collect` 的 `limits` 中包含 token 预算约束：优先保留最近交互和 State，对已归档子目标的旧 Trace 片段做摘要压缩。

---

## 五个工程补充

### E1：Agent Core 保护（内核不可变）

Agent Core 代码目录在运行时通过文件系统权限设为只读。`write` 和 `edit` 原语内置路径白名单校验，拒绝写入 Core 目录。

```
Core 目录   → 只读（文件系统权限 + 原语白名单双重保护）
Workspace   → 受 git 管理，可回滚
.agent/     → 追加写日志，不受 git 管理
```

### E2：Dry-run 验证层

高风险操作在真正执行前增加预演步骤：
- 文件操作：先在临时目录执行，确认结果符合预期再写入真实路径
- bash 命令：对支持 `--dry-run` 的命令（如 `rsync`、`terraform`）优先使用
- 代码修改：在内存中模拟 `edit` 操作，验证 `old` 字符串确实唯一匹配

Dry-run 结果写入 Terminal Log，标记为 `dry_run: true`。

### E3：能力边界声明（启动时早期失败）

在读取 AGENTS.md 之后、进入 Plan 模式之前，执行一次能力评估：

```
LLMCall[Judge(capability)](目标描述 + 权限级别 + 环境信息)
→ 完全可行    → 进入正常 Plan
→ 部分可行    → 拆解子目标，明确哪些需要升级权限或人工协助，用户确认后继续
→ 不可行      → 立即 Stop，给出原因
```

失败应尽量早暴露，不要跑完整个循环再在最后一步失败。

### E4：Context 健康度维护

防止长时间运行后 Trace 积累的过时信息污染推理：

- 已完成子目标的详细推理轨迹摘要压缩后写入 `archivedSubgoals`，不再进入 active Collect
- 被 Recovery 回滚掉的提案在 Trace 中显式标记为 `status: 'voided'`，Collect 过滤时跳过
- 每次 Session 恢复时，对上次运行的 Trace 做一次健康度检查，清理过时标记

### E5：多 Agent 协作最小接口

当需要多 agent 并行工作时，最小协作接口只需三件事：

```
共享 Workspace     同一项目目录，通过文件系统协作
共享 Trace         追加写，通过 trace_tag 区分 agent 来源
子目标所有权标记   哪个 agent 负责哪个子目标（写入 State.custom），防止冲突写入
```

不需要消息队列，不需要 RPC。文件系统 + git + 标签足够。

---

## 原语与组合关系全图（更新版）

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

## 质量追踪链（更新版）

```
Collect.confidence              LLMCall.uncertainty
─────────────────               ───────────────────
coverage:  信息充分性            score:   输出可靠性的反面
reliability: 信息可信度          reasons: 不确定的具体原因
gaps:      缺少什么
by_source: 哪个来源有问题
        │                                │
        └──────── 全部写入 Trace ─────────┘
                        │
            人类专家的 debug 入口：
            "信息不足导致推理不稳" vs
            "信息充足但模型仍不确定"（任务超出能力边界）

Terminal Log（独立信息流）
──────────────────────────
command:  原始命令
stdout:   标准输出
stderr:   错误输出
exitCode: 退出码
duration: 耗时

        ↕ 通过 terminal_seq 关联

Trace.exec 条目
```

---

## 系统健康信号（更新版）

| 指标 | 异常信号 | 指向的问题 |
|------|---------|-----------|
| Escalate 率 | 持续偏高 | confidence 阈值过严，或信息来源长期不足 |
| 无效循环率 | Judge 反复判定无增益 | Reason 的 uncertainty 持续偏高，任务分解粒度过粗 |
| Judge uncertainty | 持续偏高 | context 质量差，或裁决目标描述模糊 |
| Recovery 率 | 偏高但 Escalate 率低 | 错误分类策略未区分可重试错误，导致不必要回滚 |
| Milestone 密度 | 极低（长时间无 commit）| 任务分解粒度过粗，或 Milestone 判断阈值过严 |
| Interrupt 后恢复率 | 低 | narrative 摘要质量差，用户无法理解当前状态 |

---

## 永远不要做的事（更新版）

**原语层：**
- **修改 L0 原语的接口签名**：四个原语在整个文档中只有一个签名，永不修改。
- **让原语写入 Core 目录**：`write` 和 `edit` 必须有路径白名单，Core 代码不能被 agent 自我修改。
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
- **把所有错误都走 Recovery**：错误必须先分类，可重试错误直接重试，不回滚。
- **git 管理 `.agent/` 目录**：Trace 和 Terminal Log 是追加写日志，不需要版本管理。
- **在循环中途打断 LLMCall**：Interrupt 只在迭代边界触发，不破坏原子操作。
- **厂商锁定**：`LLMCall` 实现层保持可替换。

---

## 一句话总结

> Agent 的最小闭包是：Collect 形成足够可信的上下文，LLMCall 产出提案与不确定性，Judge 决定是否执行，执行后观察结果并更新状态，直到 Continue / Escalate / Stop——所有这一切发生在受保护的项目目录里，推理写入 Trace，执行写入 Terminal Log，策略通过 Hooks 注入，用户可以在任意迭代边界打断介入。