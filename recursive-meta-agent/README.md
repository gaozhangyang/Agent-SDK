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

**role 参数**：llm_call 可选参数 `role` 用于选择不同的 system prompt：
- `"default"`：通用助手
- `"coder"`：强调输出格式为代码块，禁止解释性文字
- `"verifier"`：强调输出 JSON，严格按 schema
- `"planner"`：强调结构化决策输出

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
    ├── meta.json                    # 节点元数据
    ├── permissions.json             # 根节点权限配置（子节点向上查找）
    └── {N_subgoal}/                # 子节点，带数字编号前缀（如 1_read_config, 2_process_data）
        ├── goal.md
        ├── context.md
        ├── script.py
        ├── results.md
        ├── meta.json
        └── ...                       # 子节点不持有 permissions.json，向上查找
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

**decomposition_id**：每个子节点对自己的 goal description 计算 hash。Recovery 时检查子节点的 decomposition_id 是否与当前 goal.md 的 hash 一致，不一致则该子节点结果作废。

---

## 权限配置

```json
// permissions.json（根节点单例，子节点向上查找）
{
  "bash": {
    "network": false,
    "delete":  false
  },
  "max_depth": 4
}
```

根节点的 permissions.json 是全局默认值。子节点**不持有** permissions.json，运行时会**向上遍历目录树**找到第一个存在的 permissions.json。子节点可以缩小权限，不可以扩大超过父节点的权限上限。权限校验是确定性逻辑，不经过 LLMCall。

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

    # 3a. 直接解决（带验证循环）
    if decision_type == 'direct':
        execute_with_verification(goal_dir, goal, context, permissions, logger, depth)
        # 验证循环：生成 script + plan → 执行 → 验证 → 失败则修订 goal 并重试

    # 3b. 分解
    elif decision_type == 'decompose':
        execute_decompose(goal_dir, goal, decision.subtasks, depth, permissions)
        # 子节点结果通过 merge_results 直接合并，不再调用 LLM
```

### Probe

```python
def probe(goal_dir, goal, permissions, depth):
    # 确定性操作：获取目录结构
    tree = bash(f"find {goal_dir} -maxdepth 2 -type f | head -40")
    
    # 读取固定候选文件（确定性规则）
    parts = []
    parts.append(f"# Directory structure\n{tree}")
    
    # 父节点 context（仅 depth > 0）
    if depth > 0:
        parent_context = read(f"{goal_dir}/../context.md")
        parts.append(f"# Parent context\n{parent_context}")
    
    # 上次执行结果（retry 场景）
    if exists(f"{goal_dir}/results.md"):
        prev_result = read(f"{goal_dir}/results.md")
        parts.append(f"# Previous execution result\n{prev_result}")
    
    # 历史记忆
    memory = get_memory_hint(logger)
    if memory:
        parts.append(f"# Memory hints\n{memory}")
    
    context = "\n\n---\n\n".join(parts)
    write(f"{goal_dir}/context.md", context)
    return context
```

Probe 是每个节点执行的第一步，**退化为纯确定性操作**。不再调用 LLM 决定读取哪些文件，而是按固定规则读取：goal.md（当前节点）、../context.md（父节点，仅 depth > 0）、results.md（如存在，retry 场景）、memory.jsonl 最近 5 条。探索环境的能力完全下放给 script.py。

### 直接执行

- **代码生成**：由 `prompts/code_generator.md` 驱动，要求模型**同时输出**一段 Python 脚本（`\`\`script` 块）和执行计划（`\`\`plan` 块），禁止 `<tool_code>` 等工具调用标记；脚本内仅使用注入的 `goal_dir`、`read`、`write`、`bash`、`llm_call`。鼓励在脚本中调用已有 skills/tools（如通过 `bash(...)`），路径未知时先探索或结合上一轮 feedback 再试。
- **验证循环**：执行 script 后，通过 `prompts/verifier.md` 调用 verifier LLM 验证结果是否满足目标。验证失败则更新 history 并重试（最多 `MAX_VERIFY_RETRY` 次，默认 2 次）。
- **马尔可夫结构**：history 退化为只保留上一时刻（last_script、last_feedback），不累积。
- **脚本执行**：在**子进程**中通过 `script_runner.py` 执行 `script.py`，子进程崩溃或超时不会拖垮主进程。子进程的 **stdout/stderr 完整捕获**，作为「控制台输出」写入 results.md 的 `--- console ---` 区块（成功与失败均保留，报错信息一并纳入）。
- **路径与重试**：运行时向脚本注入 `goal_dir`（当前节点目录），脚本应基于其拼路径，避免硬编码。若上次执行失败，feedback 信息会注入下一轮生成，便于模型修正路径或增加探索逻辑。
- **结果写入**：script.py 必须在末尾写入结构化输出：
  ```
  RESULT: 一句话说明完成了什么或失败原因
  
  OBSERVATIONS:
  - 执行过程中发现的环境事实（文件路径、API 格式、工具行为等）
  - 对后续任务有用的信息写在这里
  ```
  verifier 依赖这个结构来判断 pass/fail。

### 分解执行

```python
def execute_decompose(goal_dir, goal, subtasks, depth, permissions):
    # 创建子节点目录
    for subtask in subtasks:
        subdir = f"{goal_dir}/{subtask.name}"
        bash(f"mkdir -p {subdir}")
        write(f"{subdir}/goal.md", subtask.description)
        
        # 对每个子节点单独计算 hash
        subtask_hash = hash(subtask.description)
        
        # 写入 meta.json，每个子节点存储自己的 decomposition_id
        meta = {
            ...
            "decomposition_id": subtask_hash,
            ...
        }
        write_meta(subdir, meta)
        # 子节点不写 permissions.json，运行时向上查找
    
    # 确定性依赖校验
    validated = validate_dependencies(subtasks)

    # 按拓扑序串行执行子节点
    levels = get_execution_levels(validated)
    for level_tasks in levels:
        for task in level_tasks:
            subdir = f"{goal_dir}/{task.name}"
            meta_agent(subdir, depth + 1)
            
            # 子节点完成后，把 OBSERVATIONS 追加到父节点 context.md
            _append_observations_to_parent_context(goal_dir, task.name)
        
        # 检查子节点状态，如有失败则重试（最多 MAX_RETRY 次）
        for task in level_tasks:
            if subtask_escalated(task):
                retry_with_context(task, levels, MAX_RETRY)

    # 聚合子节点结果：直接合并各子节点的 results.md + observations
    merge_results(goal_dir, subtasks, goal, logger)
```

**子节点部分失败时重试**：发现某子节点 escalated 时，不立即 return，而是以已完成子节点的 results 作为 context 重新调用 meta_agent 执行失败子任务（最多 MAX_RETRY 次）。重试仍失败才向上 escalate。

---

## Recovery

Recovery 完全基于文件系统状态，不需要额外的状态管理。

```python
def recover(goal_dir):
    nodes = scan_tree(goal_dir)

    for node in topological_order(nodes):
        meta = read_json(f"{node}/meta.json")
        parent_decomp_id = get_parent_decomposition_id(node, goal_dir)

        # 1. results.md 存在且 decomposition_id 一致 → 跳过
        if exists(f"{node}/results.md"):
            results = parse_results_content(read(f"{node}/results.md"))
            if meta['decomposition_id'] == parent_decomp_id:
                if results['status'] != 'escalated':
                    continue  # 结果有效，跳过
                elif meta['retry_count'] >= MAX_RETRY:
                    continue  # 已达重试上限，不再重试
                # 否则删除重新执行
                rm(f"{node}/results.md")

        # 2. 分解策略变了 → 删除重新执行
        else:
            if meta['decomposition_id'] != parent_decomp_id:
                rm(f"{node}/results.md")

        # 3. 重新执行
        update_meta(node, retry_count=meta['retry_count'] + 1)
        meta_agent(node, depth=meta['depth'])
```

**不再检查 error.md**。失败信息完整写入 results.md 的 console 区块，Recovery 只读 results.md 的 status 字段判断失败。

**错误处理**：environment 类错误（权限不足、依赖缺失）立即 Escalate，不重试。其余错误统一重试，上次执行的 feedback 让 LLM 自适应调整策略。

**Escalate**：Escalate 不是独立的冒泡机制，而是 results.md 的一种内容形态。节点无法完成任务时，把 Escalate 信号写入自己的 results.md，父节点在聚合子节点结果时做确定性检查，发现 escalated 则决定重新分解或继续向上传递。接口完全统一，不需要额外的冒泡逻辑。

### results.md 格式（控制台风格 + 状态在首行）

results.md 以**可读的控制台风格**呈现：首行为执行状态，便于程序解析；其余为 `--- result ---` / `--- console ---` / `--- observations ---` 区块，便于人类查看。程序通过 `parse_results_content()` 解析，兼容本格式与旧版 JSON 格式。

```text
status: completed

--- result ---
（脚本写入的结果或默认说明）

--- observations ---
- 执行过程中发现的环境事实（文件路径、API 格式、工具行为等）
- 对后续任务有用的信息

--- console ---
（script.py 的完整 stdout/stderr，含报错时也会完整保留）
```

失败时同样会写入 results.md（status: escalated），并将子进程的完整控制台输出写入 console 区块，便于排查。

**merge_results**：分解模式下合并子节点结果时，只保留 result + observations，丢弃 console（console 不向上传递）。

---

## 全局记录

### trace.jsonl（节点级引用）

```jsonl
{"ts": 1000, "seq": 1, "kind": "node_start",     "node": "goal/subgoal-a", "goal_id": "uuid"}
{"ts": 1001, "seq": 2, "kind": "llm_call",        "node": "goal/subgoal-a", "prompt_tokens": 1200, "output_tokens": 340}
{"ts": 1002, "seq": 3, "kind": "node_completed",  "node": "goal/subgoal-a", "goal_id": "uuid"}
{"ts": 1003, "seq": 4, "kind": "node_failed",     "node": "goal/subgoal-b", "reason": "verification_failed"}
{"ts": 1004, "seq": 5, "kind": "escalate",        "node": "goal/subgoal-b", "reason": "retry_exceeded"}
```

Trace 只记录节点级事件和引用，不重复存储内容。需要详情时通过 node 路径跳转到节点目录读取 context.md / results.md。

### terminal.md（一级检索）与调试编号

每一级目标在终端显示时会在名称前加上**当前层内的序号**（如 `1. prepare_directories`、`2. fetch_cv_papers`），便于调试与对号入座。根目标显示为 `1. {goal_name}`，子层内按执行顺序为 1、2、3…

```markdown
📍 [seq=1] 1. survey_xxx 开始执行
📍 [seq=2] 1. prepare_directories 开始执行
📍 [seq=3] 1. prepare_directories 完成 → results.md
📍 [seq=4] 2. fetch_cv_papers 开始执行
⚠️  [seq=5] 2. fetch_cv_papers 失败 → ...
📍 [seq=6] 1. survey_xxx 完成 → results.md
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

包含：四个原语、probe-first、直接执行与分解执行、递归子节点、聚合 results.md、decomposition_id 校验、确定性依赖校验层、基于文件系统的 Recovery、深度限制、全局 trace / terminal / state 记录；script 在子进程中执行（script_runner.py）、控制台输出完整进 results.md、results.md 控制台风格（首行 status + result/console 区块）、每级目标名前编号便于调试。

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

> meta-agent 是一个递归函数：probe 退化为确定性操作，决策直接解决或分解子任务。直接解决模式：LLMCall 生成 script + plan，执行后通过 verifier（合并了 revise）验证结果，验证失败则更新 history 并重试（马尔可夫结构，最多 MAX_VERIFY_RETRY 次）。分解执行模式：递归执行子节点，子节点失败时重试（最多 MAX_RETRY 次），然后通过 merge_results 直接合并子节点 results + observations。script.py 以确定性代码 + LLMCall 的混合脚本执行，必须输出 RESULT + OBSERVATIONS 结构；results.md 写入即成符号事实；目录树即任务树，文件系统即执行状态，Recovery 只读 results.md 判断失败，四个原语组合实现一切能力。


## 测试结果

### 核心功能实现

1. **四个原语**: read, write, bash, llm_call - 已实现并测试
2. **meta_agent 核心递归函数**: 已实现
3. **probe 函数**: 已实现（退化为确定性操作）
4. **依赖校验层**: 实现了缺失依赖检测和循环依赖检测
5. **串行执行**: 按拓扑序逐节点执行
6. **Recovery 机制**: 基于文件系统的状态恢复（只读 results.md）
7. **全局记录**: trace.jsonl, terminal.md, state.jsonl（终端中每级目标名前带序号便于调试）
8. **权限控制**: permissions.json 向上查找机制
9. **子节点重试**: execute_decompose 支持子节点部分失败时重试
10. **马尔可夫结构**: history 退化为只保留上一时刻
11. **script 子进程执行**: 通过 `src/script_runner.py` 在子进程中执行 script.py，隔离崩溃；控制台输出完整写入 results.md。超时由环境变量 `SCRIPT_RUN_TIMEOUT`（秒，默认 600）控制。

### 自定义 Prompt

所有 LLM 调用的 prompt 都已抽离到 `prompts/` 目录下的 `.md` 文件中。用户可以通过修改这些文件来自定义模型行为，无需修改代码。

#### prompts 目录结构

```
prompts/
├── system_prompt.md     # 系统级 prompt，基础角色定义（决策/分解等用）
├── code_generator.md    # 代码生成 prompt（直接执行）：同时输出 script + plan、要求 OBSERVATIONS 输出
├── decision.md         # 决策 prompt（直接解决还是分解；含 context 充分性评估）
├── decomposer.md       # 任务分解 prompt
└── verifier.md        # 验证器 prompt（输出 pass/feedback）
```

#### 如何自定义

1. **修改系统 prompt**: 编辑 `prompts/system_prompt.md` 可以改变模型的基础角色定义
2. **修改特定行为**: 
   - 修改 `prompts/decision.md` 可以改变任务分解策略（含「是否先分解探索环境」）
   - 修改 `prompts/decomposer.md` 可以改变子任务生成方式
   - 修改 `prompts/code_generator.md` 可以改变代码生成风格与路径/探索/反馈 策略
   - 修改 `prompts/verifier.md` 可以改变结果验证逻辑

prompt 模板使用 Python 格式化字符串语法，变量用 `{}` 包裹。例如 `{goal}`、`{context}` 等。

### 入口使用

```bash
# 正常运行
python main.py --goal-dir ./my_task

# 恢复模式
python main.py --goal-dir ./my_task --recover