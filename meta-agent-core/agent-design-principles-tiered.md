# Coding Agent 设计原则分级指南

> 视角：非必要不复杂，追求简约

---

## 声明：原则层 vs 默认实现层

本文档严格区分两个层次：
- **原则定义**：什么是原语，什么是边界，什么必须显式建模——这些是稳定的。
- **默认实现**：`bash + git`、`bash + grep/ripgrep`、MCP、标签写入方式等——推荐实践，不是唯一正确实现。

**质量信号总规则：所有 `confidence` 和 `uncertainty` 统一写入 Trace。** 这是系统可调试性的基础，后文不再重复。

---

## 核心心智模型：Agent 即"写书"过程

解决问题的过程，就是把一本书写好的过程。这本书就是 **agent 的推理轨迹**（Trace）——记录所有思考、工具调用、中间结果与质量信号。书是线性的，但可以在任意位置触发新的 LLM 调用来展开子问题，这个过程允许递归。

但 Trace 只是日志，不等于全部状态。完整的 agent 运行时有三个不同性质的信息对象：

```
Trace      → 发生过什么（可追加日志，含标签、confidence、uncertainty）
State      → 现在是什么状态（结构化 KV：目标、子目标、当前模式、权限级别、版本号）
Workspace  → 外部世界的当前事实（优先读取可稳定复现的事实；运行时环境按需读取，
             可靠性较低，在 confidence.by_source 中显式标注）
```

**"子 Agent"的本质与消解：** 所谓"子 agent"，无非是一次具备特殊 context 的 LLMCall。不同 agent 之间的差异归根结底只是 context 不同，因此子 agent 作为独立运行时边界可以被消解——但 **Role/Mode 仍然是必要的控制边界**，不能被隐式地压进 `Collect` 配置里。

---

## 核心信念

> **复杂性本身是成本。** 只有在简单方案明显不够用时，才引入复杂性。  
> **架构应当收敛，而非扩张。** 每一个可以被统一的概念，都应该被统一。  
> **原语必须是原子的。** 能被其他原语组合实现的，不是原语，是约定或协议。

---

## Level 0：所有 Agent 必须具备

### L0.1 四个执行原语

接口定义稳定不变，不在任何其他章节被修改：

| 原语 | 签名 | 职责 |
|------|------|------|
| read | `read(path) → content` | 读取文件/资源 |
| write | `write(path, content)` | 创建或覆写文件 |
| edit | `edit(path, old, new)` | 精确局部替换，`old` 须在文件中唯一匹配 |
| bash | `bash(command) → output` | 执行系统命令 |

### L0.2 推理引擎：`LLMCall`

```
LLMCall(context, input) → { result, uncertainty{score, reasons} }
```

`LLMCall` 是驱动循环的推理引擎，无法被任何工具调用替代自身。有两种模式：

- **Reason**：生成提案、写代码、制定计划。不确定性高时应生成多候选而非单一提案。
- **Judge(type)**：收敛裁决，`type ∈ {outcome, risk, selection}`。不确定性高时应 Escalate 而非执行。每次 Judge 调用必须显式指定 type，不能用模糊的"判断一下"覆盖所有情形。[^judge]

[^judge]: outcome = 是否达成子目标；risk = 是否允许执行/权限是否满足；selection = 多候选方案中选哪一个。实现层可共用同一模型，但 prompt 模板和评估标准应分开。

### L0.3 上下文编排协议：`Collect`

```
Collect(sources, filters, limits) → { context, confidence{coverage, reliability, gaps, by_source} }
```

`Collect` 是**编排协议**，不是原语。其复杂性是策略复杂性（检索、排序、截断、压缩），将它视为原语会导致所有复杂性被塞进去变成黑箱。

`coverage`（信息充分性）与 `reliability`（信息可信度）必须分开，因为它们对应不同处理路径：

```
coverage 高，reliability 高  → LLMCall[Reason]
coverage 低，reliability 高  → 补充采集（再次 Collect）
coverage 高，reliability 低  → 刷新来源或 Escalate
coverage 低，reliability 低  → 直接 Escalate
```

中置信度时最多重试 N 次，防止无限补采集循环。

### L0.4 核心执行循环

```
┌──────────────────────────────────────────────────────────┐
│  1. Collect → { context, confidence }                    │
│       ↓ 高置信度   ↓ 中（补采集，≤N次）   ↓ 低→Escalate  │
│  2. LLMCall[Reason] → { proposal, uncertainty }          │
│       ↓ 低不确定性          ↓ 高→多候选或 Escalate        │
│  3. LLMCall[Judge(risk)] → { decision, uncertainty }     │
│       ↓ 通过且不确定性低    ↓ 拒绝或不确定性高→阻断        │
│  4. 执行工具 [harness 自动快照]                           │
│  5. Observe：读取真实结果                                 │
│  6. LLMCall[Judge(outcome)] → { verdict, uncertainty }   │
│       ↓ 达成且不确定性低    ↓ 未达成或不确定性高→Recovery  │
│  7. Update State                                         │
│  8. Continue / Escalate / Stop                           │
│     ├── 目标已完成 → Stop                                │
│     ├── 连续无增益 → Escalate                            │
│     ├── 超出预算（token/时间/操作次数）→ Stop             │
│     └── 否则 → Continue                                  │
└──────────────────────────────────────────────────────────┘
```

终止条件是一等概念，不是循环的附属品。

### L0.5 静态上下文注入（AGENTS.md）

纯文本文件，会话启动时自动读取，提交到 Git，团队共享。最可靠、最可调试的长期记忆基础形式。

### L0.6 Harness 约定：自动版本快照

三条硬性规则：
1. **快照失败默认阻断副作用执行**（降级模式需显式声明并记录到 Trace）
2. **只对可能产生持久副作用的操作快照**（只读的 `bash ls` 等不需要）
3. **以"变更批次"为单位快照**（不要每条命令都 commit，避免历史爆炸）

回退操作（`bash git checkout`）可由 Judge 裁决触发，也可由用户直接触发，共用同一机制。

---

## Level 1：大多数场景需要

### L1.1 权限状态机

存储在 `State.permissions`，分五级，升级需显式申请，不隐式提升：

```
Level 0  只读          read
Level 1  受控写        write / edit（限工作区）
Level 2  受控执行      bash（常规，无网络/删除）
Level 3  高风险执行    bash（网络、删除、系统级变更）
Level 4  自主模式      预授权范围内自动执行
```

即使在 Level 4，不可逆的破坏性操作仍应二次确认。

### L1.2 Role/Mode 状态机

存储在 `State.mode`，每次切换记录到 Trace。没有切换规则的 Mode 只是标签，不是控制机制：

```
Plan 模式      只读 + LLMCall[Reason]，不触发有副作用的工具
Execute 模式   完整工具访问，执行已批准的动作
Review 模式    只读 + LLMCall[Judge(outcome)]，检查不生成
Recovery 模式  只允许 bash(git) 和 read，专注诊断与回退
```

**切换规则：**

```
Plan    → Execute   方案通过 Judge(risk)，且权限满足
Execute → Review    当前批次动作完成
Review  → Execute   Judge(outcome) 通过，且仍有剩余子目标
Review  → Plan      目标变化，或需重新规划
任意    → Recovery  连续失败 / 结果冲突 / 快照失败 / 回滚触发
任意    → Plan      上下文重大变化（用户补充信息、外部状态突变）
```

### L1.3 精确代码搜索

代码库变大后，在 `Collect` 的检索层加入基于 `bash`（ripgrep/grep）的正则检索，优先于向量索引。前沿模型天生会写精准的正则；向量索引需要维护、会漂移、召回不稳定。

### L1.4 标签/书签约定

对 Trace 片段附加领域标签元数据（`write` 写入），`Collect` 按标签过滤（`bash` grep）。这是现有原语的组合约定，保留了子 agent 打标签的核心价值，同时消解了独立 agent 的架构概念。

> **记忆分层**（多会话场景才需要）：工作记忆（当前任务，会话级）、过程记忆（历史轨迹、失败案例）、长期偏好记忆（跨会话持久化）。三类生命周期和检索方式不同，不应混入同一标签池。

### L1.5 提供商无关抽象

`LLMCall` 实现层对接多家模型提供商，对上层逻辑透明。不同 Judge type 和 Reason 可路由到不同规格模型，这是实现细节。

### L1.6 上下文窗口预算管理

在 `Collect` 的 `limits` 中加入 token 预算约束：优先保留最近交互和 State，对旧 Trace 片段做摘要压缩（可借助轻量 `LLMCall[Reason]`）。

---

## Level 2：特定场景按需添加

### L2.1 动态 Context 构建策略

`Collect` 的静态配置不足时，将构建策略本身变为可配置的。不同"角色"只是不同的 `Collect` 配置（system prompt + 检索标签 + State 字段组合），不需要独立 agent 实例。

### L2.2 变更提案工作流

**`edit(path, old, new)` 原语定义不变**，复杂变更在调用它前增加提案步骤：

```
{ diff_spec, uncertainty } = LLMCall[Reason](context, change_spec)
# uncertainty 高时：生成多候选，走 Judge(selection) 仲裁
for each (path, old, new) in parse(diff_spec):
    edit(path, old, new)
```

### L2.3 轻量并行候选

无副作用阶段，多个候选方案并行生成后由 Judge(selection) 仲裁：

```
proposals = parallel[ LLMCall[Reason](context, task) × N ]
{ best, uncertainty } = LLMCall[Judge(selection)](context, proposals)
```

高 uncertainty 的 proposal 在仲裁时自动降权。

### L2.4 MCP 外部能力适配层

**MCP 不是新的执行原语，而是外部能力适配层。** 对 agent 内核而言，它暴露"可调用能力端点"，不改变最小原语集合。从架构哲学层看，执行原语始终只有四个；从系统实现层看，MCP 是挂载在原语之上的插件化外设。

不要推导出"原语可以一直加，只要挂到 MCP 里就行"——这会破坏整个框架的收敛原则。

---

## Level 3：高级产品功能（大多数项目不需要）

### L3.1 重隔离并行执行

多条完整循环并行运行在独立环境（VM / Git worktree）中，由 Judge(selection) 对比 uncertainty 选优。L2.3 的轻量并行在大多数场景已足够。

### L3.2 代码库语义索引

在 `Collect` 检索层加入嵌入向量检索，提升大型代码库的语义召回率（改善 `confidence.coverage`）。优先用正则，只有正则明显不足时再考虑。

### L3.3 智能模型路由

`LLMCall` 根据调用类型和历史 uncertainty 分布，动态路由到不同规格模型。

### L3.4 事件溯源状态管理

将 State + Trace 升级为严格事件溯源模型，支持确定性回放和跨客户端共享状态。L0.6 的自动快照在大多数场景已足够。

---

## 原语与组合关系全图

```
原子原语（接口稳定，不可分解）
├── LLMCall(context, input) → { result, uncertainty }
│   ├── Reason：发散生成
│   └── Judge(type)：收敛裁决，type ∈ {outcome, risk, selection}
├── read(path) → content
├── write(path, content)
├── edit(path, old, new)
└── bash(command) → output

编排协议（策略复杂性，非原子）
└── Collect(...) → { context, confidence{coverage, reliability, gaps, by_source} }

外部能力适配（不改变原语集合）
└── MCP：插件化外设

由原语组合实现的能力（不是新原语）
├── 标签检索    = write（标签）+ bash grep + Collect 过滤
├── 版本快照    = bash git commit [harness 自动触发]
├── 版本回退    = bash git checkout [Judge 或用户触发]
├── 代码搜索    = Collect 内调用 bash ripgrep
├── 上下文压缩  = LLMCall[Reason]（摘要）+ write（写回）
├── 子 agent   = Collect（特定配置）+ LLMCall（特定 prompt）
├── 变更提案    = LLMCall[Reason]（生成 diff）+ 多次 edit
└── 轻量并行    = parallel LLMCall[Reason] + LLMCall[Judge(selection)]
```

---

## 质量追踪链

```
Collect.confidence          LLMCall.uncertainty
─────────────────           ───────────────────
coverage:  信息充分性        score:   输出可靠性的反面
reliability: 信息可信度      reasons: 不确定的具体原因
gaps:      缺少什么
by_source: 哪个来源有问题
        │                            │
        └──────── 全部写入 Trace ────┘
                       │
           人类专家的 debug 入口：
           "信息不足导致推理不稳" vs
           "信息充足但模型仍不确定"（任务超出能力边界）
```

---

## 系统健康信号

| 指标 | 异常信号 | 指向的问题 |
|------|---------|-----------|
| Escalate 率 | 持续偏高 | confidence 阈值过严，或信息来源长期不足 |
| 无效循环率 | Judge 反复判定无增益 | Reason 的 uncertainty 持续偏高，任务分解粒度过粗 |
| Judge uncertainty | 持续偏高 | context 质量差，或裁决目标描述模糊 |

---

## 永远不要做的事

- **修改 L0 原语的接口签名**：`edit(path, old, new)` 在整个文档中只有一个签名，上层工作流可演化，原语层必须稳定。
- **把 `Collect` 当原语**：它是编排协议，叫它原语会让复杂性变成黑箱。
- **把 MCP 称为新执行原语**：它是适配层，否则原语会无限膨胀。
- **让 Judge 承担模糊职责**：每次 Judge 调用必须显式指定 `type`。
- **没有切换规则的 Mode**：状态机转移表缺失时，Mode 只是标签。
- **只维护 Trace，不维护 State**：从日志反推状态既低效又不稳。
- **不定义终止条件**："停不下来"是 agent 系统最常见的故障。
- **厂商锁定**：`LLMCall` 实现层保持可替换。

---

## 一句话总结

> Agent 的最小闭环是：Collect 形成足够可信的上下文，LLMCall 产出提案与不确定性，Judge 决定是否执行，执行后观察结果并更新状态，直到 Continue / Escalate / Stop。
