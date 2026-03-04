# Meta-Agent 设计文档

> 简洁但能力完备。LLMCall 是唯一的随机性入口，其余一切保持确定性。

---

## 根本原则

- **概率性输出需要确定性外壳。** LLMCall 的不确定性封闭在调用边界内，结果写入符号空间后即成为确定性事实。
- **目录树即任务树。** 任务结构、执行状态、中间结果全部体现在文件系统上，不需要额外的状态管理。
- **LLMCall 是编程原语。** 确定性代码负责流程控制和状态管理，LLMCall 负责语义理解和智能判断，两者在 script.py 里自然组合。
- **先 probe 再执行。** meta-agent 的第一个动作永远是以最小代价理解任务形状，不盲目执行。
- **results.md 是节点的类型签名。** 父节点只通过读取子节点的 results.md 消费结果，不感知子节点的内部实现。
- **复杂性本身是成本。** 只有简单方案明显不够用时，才引入复杂性。

---

## 四个原语

所有能力由四个原语组合实现，接口永不修改。

```python
read(path)                    → content   # 读取文件，跨节点只读
write(path, content)          → void      # 写文件，默认限当前节点目录
bash(command)                 → output    # 确定性执行，输出完整捕获
llm_call(context, prompt)     → result    # 唯一的随机性入口
```

**read**：可读取任意有权限的路径，包括父节点、兄弟节点的 results.md，以及公共工作区。跨节点只读不写。

**write**：默认只能写当前节点目录内的文件。写公共工作区需要显式权限。路径白名单由节点的 permissions.json 控制。

**bash**：执行任意 shell 命令。输出超过 maxOutputLength 时截断并标记。git 为必要前置依赖，启动时检测不可用则 fail。

**llm_call**：接收 context（字符串或字符串列表）和 prompt，返回结果字符串。内部处理 token 预算，超出时优先截断低优先级 context，不静默丢弃。调用结果写入符号空间后，不确定性即消除。

**风险信号**：llm_call 可附带返回 `risk_signal { level: low|medium|high, reason: string }`，供外层确定性逻辑决策是否 escalate，不由 LLM 自己做 proceed/block 判断。

---

## 文件系统结构

```
{workDir}/
├── .agent/                          # 公共工作区，全局可读写（权限控制）
│   ├── trace.jsonl                  # 全局追踪，记录节点级引用
│   ├── terminal.md                  # 全局执行日志，一级检索入口
│   ├── state.jsonl                  # 全局状态流水，追加写
│   ├── memory.jsonl                 # 跨 Session 长期记忆
│   ├── AGENT.md                     # 全局配置，根节点约束，子节点继承
│   └── sessions/                   # 每次运行摘要索引
│
└── {goal}/                          # 根节点，对应用户原始问题
    ├── goal.md                      # 任务描述，只读，由父节点或用户写入
    ├── context.md                   # probe 阶段收集的信息，供检索
    ├── script.py                    # 解决当前任务的可执行脚本
    ├── results.md                   # 节点输出，写入后即为确定性事实
    ├── error.md                     # 失败现场，记录原始错误信息
    ├── meta.json                    # 节点元数据
    ├── permissions.json             # 节点权限配置，可缩小不可扩大
    └── {subgoal}/                   # 子节点，结构与父节点完全一致
        ├── goal.md
        ├── context.md
        ├── script.py
        ├── results.md
        ├── error.md
        ├── meta.json
        ├── permissions.json
        └── ...
```

**.agent/ 公共工作区**：全局唯一，所有节点共享。trace.jsonl 和 terminal.md 只记录节点级引用（节点路径 + seq），不重复存储内容，按需跳转到节点目录读取详情。

**节点目录**：每个节点是完全自包含的执行单元。给定一个节点目录，meta-agent 可以独立执行，不需要感知父节点或兄弟节点的存在。

**子任务名称验证**：当 LLM 返回子任务列表时，系统会自动验证和清理子任务名称，确保它们是有效的目录名。规则如下：
- 只允许字母、数字、下划线、连字符
- 空格会被替换为下划线
- 特殊字符（斜杠、冒号、星号等）会被移除
- 前后空白会被移除
- 空名称会生成默认名称
- 名称会被截断到 64 字符以避免超长路径问题

---

## 节点元数据

```json
{
  "goal_id": "uuid",
  "parent_goal_id": "uuid | null",
  "depth": 2,
  "decomposition_id": "hash",        // 父节点本次分解决策的 hash
  "status": "not_started | running | completed | failed | escalated",
  "retry_count": 0,
  "context_truncated": false,        // context 是否因预算不足被截断
  "created_at": "ts",
  "completed_at": "ts | null"
}
```

**decomposition_id**：父节点每次重新分解时生成新 hash。Recovery 时检查子节点的 decomposition_id 是否与父节点当前分解一致，不一致则子节点结果作废。

---

## 权限配置

```json
// permissions.json（节点级，覆盖默认值）
{
  "read":  ["../sibling/results.md", "../../parent/context.md"],
  "write": [".agent/"],
  "bash": {
    "network": false,
    "delete":  false
  },
  "max_depth": 3
}
```

根节点的 permissions.json 是全局默认值。子节点可以缩小权限，不可以扩大超过父节点的权限上限。权限校验是确定性逻辑，不经过 LLMCall。

---

## AGENT.md 全局配置

AGENT.md 只存在于 .agent/ 目录，描述全局约束，子节点继承，不各自持有。

```markdown
# [all]
maxOutputLength: 102400
contextBudget: { total: 200000, reservedOutput: 4000 }
maxRetry: 3

# [decompose]
max_depth: 4
complexity_threshold: "..."    // 注入分解决策的 LLMCall

# [judge]
outcome_criteria: "..."        // 注入结果验收的 LLMCall

# [learned_patterns]
// 人工写入，Agent 只读，Probe 阶段注入 context
```

按调用类型只注入相关 section，不全量注入。

---

## meta-agent 核心 Loop

meta-agent 是一个递归函数，接口极简：输入一个目录，输出 results.md。

```python
def meta_agent(goal_dir, depth=0):
    goal        = read(f"{goal_dir}/goal.md")
    meta        = read_json(f"{goal_dir}/meta.json")
    permissions = load_permissions(goal_dir)

    # 1. Probe：以最小代价理解任务形状
    context = probe(goal_dir, goal, permissions)

    # 2. 决策：直接解决 or 分解
    if depth >= permissions.max_depth:
        decision_type = 'direct'    # 深度限制，强制直接解决
    else:
        decision = llm_call(
            context=context,
            prompt="直接解决还是分解为子任务？返回 JSON: {type, subtasks?}"
        )
        decision_type = decision.type

    # 3a. 直接解决
    if decision_type == 'direct':
        execute_direct(goal_dir, goal, context)

    # 3b. 分解
    elif decision_type == 'decompose':
        execute_decompose(goal_dir, goal, decision.subtasks, depth, permissions)
```

### Probe

```python
def probe(goal_dir, goal, permissions):
    # 只读目录结构和文件大小，不读内容
    tree  = bash(f"find {goal_dir} -maxdepth 2 -name '*.md'")
    sizes = bash(f"wc -c {goal_dir}/*.md 2>/dev/null")

    # 可读取历史记忆作为参考
    memory_hint = bash(f"tail -n 5 .agent/memory.jsonl")

    # LLM 决定需要读哪些文件，按优先级排列
    needed = llm_call(
        context=[tree, sizes, memory_hint, goal],
        prompt="列出需要读取的文件路径（按优先级），以理解任务。返回 JSON。"
    )

    # 按优先级拉取，预算耗尽则停止，标记 context_truncated
    context = pull_within_budget(needed.files_by_priority, permissions.contextBudget)
    write(f"{goal_dir}/context.md", context)
    return context
```

Probe 是每个节点执行的第一步，永远发生。输入只有目录结构和文件大小，LLMCall 极其便宜。

### 直接执行

```python
def execute_direct(goal_dir, goal, context):
    # 如有失败现场，注入 error 信息
    error_hint = read(f"{goal_dir}/error.md") if exists(f"{goal_dir}/error.md") else ""

    # 生成 script.py
    script = llm_call(
        context=[goal, context, error_hint],
        prompt="生成解决此任务的 Python 脚本。可使用 read/write/bash/llm_call 四个原语。"
    )
    write(f"{goal_dir}/script.py", script)

    # 确定性执行脚本
    try:
        output = bash(f"python {goal_dir}/script.py")
        log_success(goal_dir, output)
        # results.md 由 script.py 内部的 write() 写入

    except Exception as e:
        write(f"{goal_dir}/error.md", str(e))
        update_meta(goal_dir, status='failed')
        raise
```

### 分解执行

```python
def execute_decompose(goal_dir, goal, subtasks, depth, permissions):
    decomposition_id = hash(str(subtasks))

    # 创建子节点目录
    for subtask in subtasks:
        subdir = f"{goal_dir}/{subtask.name}"
        bash(f"mkdir -p {subdir}")
        write(f"{subdir}/goal.md", subtask.description)
        write(f"{subdir}/meta.json", {
            "decomposition_id": decomposition_id,
            "depth": depth + 1,
            "status": "not_started",
            "retry_count": 0
        })

    # 确定性依赖校验（两关，校验失败重新生成，不 Escalate）
    # 第一关：depends_on 里的每个依赖必须存在于当前子任务列表
    # 第二关：拓扑排序检测，不允许循环依赖
    # 校验失败时把错误信息注回 LLMCall，重新产出依赖关系
    validated = validate_dependencies(subtasks)

    # 按依赖关系执行，按拓扑序串行执行子节点
    execute_by_dependency(validated, goal_dir, depth)

    # 聚合子节点结果：创建并执行 script.py
    # script.py 内部读取各子节点的 results.md，调用 llm_call 合成最终结果
    script = llm_call(
        context=[goal],
        prompt="生成 Python 脚本，用于聚合各子节点结果并回答原始问题"
    )
    write(f"{goal_dir}/script.py", script)
    exec(f"python {goal_dir}/script.py")
    # results.md 由 script.py 内部的 write() 写入
    update_meta(goal_dir, status='completed')
```

---

## Recovery

Recovery 完全基于文件系统状态，不需要额外的状态管理。

```python
def recover(goal_dir):
    nodes = scan_tree(goal_dir)

    for node in topological_order(nodes):
        meta              = read_json(f"{node}/meta.json")
        parent_decomp_id  = get_parent_decomposition_id(node)

        # 已完成：检查 decomposition_id 是否仍然可信
        if exists(f"{node}/results.md"):
            if meta['decomposition_id'] == parent_decomp_id:
                continue                        # 可信，跳过
            else:
                bash(f"rm {node}/results.md")   # 分解策略变了，作废

        # 超过重试上限：向上 Escalate
        if meta['retry_count'] >= MAX_RETRY:
            escalate(node, read(f"{node}/error.md"))
            continue

        # 有失败现场或未开始：重新执行
        # error.md 存在时会被 Probe 自动读取，LLM 看到失败原因后生成不同脚本
        update_meta(node, retry_count=meta['retry_count'] + 1)
        meta_agent(node, depth=meta['depth'])
```

**错误处理**：environment 类错误（权限不足、依赖缺失）写入 error.md 并立即 Escalate，不重试。其余错误统一重试，error.md 的内容让 LLM 自适应调整策略。retryable / logic 的区别消失——LLM 从 error.md 读取失败原因，自然生成修正后的脚本。

**Escalate**：Escalate 不是独立的冒泡机制，而是 results.md 的一种内容形态。节点无法完成任务时，把 Escalate 信号写入自己的 results.md，父节点在聚合子节点结果时做确定性检查，发现 escalated 则决定重新分解或继续向上传递。接口完全统一，不需要额外的冒泡逻辑。

```json
// results.md 的两种形态
{ "status": "completed",  "result": "..." }
{ "status": "escalated",  "reason": "...", "error_ref": "error.md" }
```

---

## 全局记录

### trace.jsonl（节点级引用）

```jsonl
{"ts": 1000, "seq": 1, "kind": "node_start",     "node": "goal/subgoal-a", "goal_id": "uuid"}
{"ts": 1001, "seq": 2, "kind": "llm_call",        "node": "goal/subgoal-a", "prompt_tokens": 1200, "output_tokens": 340}
{"ts": 1002, "seq": 3, "kind": "node_completed",  "node": "goal/subgoal-a", "goal_id": "uuid"}
{"ts": 1003, "seq": 4, "kind": "node_failed",     "node": "goal/subgoal-b", "error_ref": "goal/subgoal-b/error.md"}
{"ts": 1004, "seq": 5, "kind": "escalate",        "node": "goal/subgoal-b", "reason": "retry_exceeded"}
```

Trace 只记录节点级事件和引用，不重复存储内容。需要详情时通过 node 路径跳转到节点目录读取 context.md / error.md。

### terminal.md（一级检索）

```markdown
📍 [seq=1] goal/subgoal-a 开始执行
📍 [seq=3] goal/subgoal-a 完成 → results.md
⚠️  [seq=4] goal/subgoal-b 失败 → error.md
📍 [seq=7] goal/subgoal-b 重试成功 → results.md
📍 [seq=9] goal 完成 → results.md
```

terminal.md 是人类可读的执行流水账，作为一级检索入口。📍 标记关键事件，⚠️ 标记失败，按需跳转到节点目录下钻。

### state.jsonl（全局状态流水）

```jsonl
{"ts": ..., "seq": 1, "event": "session_start",    "root": "goal/",      "session_id": "uuid"}
{"ts": ..., "seq": 2, "event": "depth_exceeded",   "node": "goal/a/b/c", "depth": 4}
{"ts": ..., "seq": 3, "event": "escalate",         "node": "goal/b",     "reason": "..."}
{"ts": ..., "seq": 4, "event": "session_complete", "results": "goal/results.md"}
```

state.jsonl 追加写，跨 Session 累积，不清空。崩溃重启时读取最后一条确定续接点。

### memory.jsonl（跨 Session 长期记忆）

```jsonl
{
  "ts": ...,
  "session_id": "uuid",
  "task_type": "code_refactor",
  "goal_summary": "...",
  "solution_pattern": "...",
  "reliability": 0.9,
  "depth_used": 2,
  "avg_retries": 0.3
}
```

写入时机：根节点 results.md 成功写入后提炼，崩溃续接不提炼。检索时 reliability 低的条目降权不排除。Probe 阶段读取作为历史参考。

---

## 分级实现路线

**L1 · 最小完备单元**
meta-agent 的完整核心，不可再拆分。能跑、能递归、能自愈、留完整痕迹。

包含：四个原语、probe-first、直接执行与分解执行、递归子节点、聚合 results.md、decomposition_id 校验、确定性依赖校验层、基于文件系统的 Recovery、深度限制、error.md 写入、全局 trace / terminal / state 记录。

一个不能递归的单元不是最小智能单元，是一个普通的 LLM wrapper。L1 必须包含递归才有意义。

**L2 · 可控可中断**
人可在任意节点边界介入，策略可替换，Agent 不越权。

新增：Interrupt 机制（迭代边界触发，不中断 LLMCall）、节点级权限继承与校验、风险信号确定性决策层（llm_call 返回 risk_signal，由确定性层决策 proceed / escalate）、AGENT.md 全局配置激活。

**L3 · 记忆与自我感知**
从历史学习，感知自身运行状态，产出优化建议供人审核。

新增：memory.jsonl 检索与写入、Probe 阶段注入历史模式、运行时自我观测（retry 率、depth 分布、llm_call 成本趋势）、optimization_report 产出。Agent 不自动修改 AGENT.md，产出证据，人做决策。

---

## 永远不要做的事

- 修改四个原语的接口签名
- 不定义终止条件（max_depth + MAX_RETRY 是硬性约束，不可省略）
- 让子节点写父节点的目录（跨节点只读不写）
- 在 LLMCall 内部做权限决策（权限校验是确定性逻辑）
- 让 results.md 被覆盖写入（写入即为不可变事实，覆盖需先显式作废）
- 在 script.py 执行过程中截断 LLMCall（预算不足在 Probe 阶段提前处理）
- 新 Session 覆盖旧 Session（崩溃重启是续接，不是重置）
- 让 Agent 自动修改 AGENT.md（优化建议必须经人工审核）
- 把所有错误都走 Escalate（environment 错误才 Escalate，其余重试）

---

## 一句话总结

> meta-agent 是一个递归函数：probe 以最小代价理解任务形状，决策直接解决或分解子任务，script.py 以确定性代码 + LLMCall 的混合脚本执行，results.md 写入即成符号事实；目录树即任务树，文件系统即执行状态，Recovery 是树扫描而非状态回滚，四个原语组合实现一切能力。


## 测试结果

### 核心功能实现

1. **四个原语**: read, write, bash, llm_call - 已实现并测试
2. **meta_agent 核心递归函数**: 已实现
3. **probe 函数**: 已实现
4. **依赖校验层**: 实现了缺失依赖检测和循环依赖检测
5. **串行执行**: 按拓扑序逐节点执行
6. **Recovery 机制**: 基于文件系统的状态恢复
7. **全局记录**: trace.jsonl, terminal.md, state.jsonl
8. **权限控制**: permissions.json 加载与权限校验

### 入口使用

```bash
# 正常运行
python main.py --goal-dir ./my_task

# 恢复模式
python main.py --goal-dir ./my_task --recover