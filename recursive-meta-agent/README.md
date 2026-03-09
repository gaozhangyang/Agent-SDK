# Meta-Agent 设计文档

> 简洁但能力完备。LLMCall 是唯一的随机性入口，其余一切保持确定性。

---

## 根本原则

- **概率性输出需要确定性外壳。** LLMCall 的不确定性封闭在调用边界内，结果写入符号空间后即成为确定性事实。
- **目录树即任务树。** 任务结构、执行状态、中间结果全部体现在文件系统上，不需要额外的状态管理。
- **LLMCall 是编程原语。** 确定性代码负责流程控制和状态管理，LLMCall 负责语义理解和智能判断，两者在 script.py 里自然组合。
- **先 probe 再执行。** meta-agent 的第一个动作永远是以最小代价理解任务形状，不盲目执行。
- **context.md 是唯一的信息载体。** 子节点完成后写入父节点 context.md，供后续兄弟任务订阅。
- **根节点是唯一例外。** 保留 results.md 作为最终输出，供用户查看。
- **去重优化。** 为避免深层节点 context 冗余，读取父节点 context 时自动去除公共部分（目录结构、Allowed external directories），追加 observation 时逐行去重。
- **间接信息解引用。** 通过 `<<read>>` 块机制，probe 阶段自动将文件路径解引用为文件内容，支持截断处理避免 context 膨胀。
- **复杂性本身是成本。** 只有简单方案明显不够用时，才引入复杂性。

---

## 第二轮改动概述（2025）

本轮改动围绕三个主题：
1. **verifier 职责重定位**：从 pass/fail 判断改为直接信息提取
2. **decomposer 补充兄弟任务上下文**：让 verifier 知道"哪些信息对后续有用"
3. **引入 `<<read>>` 间接信息机制**：probe 阶段自动解引用

---

## 最终算法

```python
def meta_agent(goal_dir, depth):
    # 探针：读取父节点context.md + 当前环境，形成当前节点的上下文
    context = probe(goal_dir)

    if depth >= max_depth or decision == "direct":
        # 直接执行模式：LLM生成script，执行后产生observation
        script = LLMCall(context, goal)
        observation = Act(script)  # script主动print出需要被观测的信息

        # 验证：verifier 提取 direct_info 和 indirect_files
        verification = LLMCall(verifier, script, observation)
        direct_info = verification.direct_info
        indirect_files = verification.indirect_files

        # 失败信息也是 direct_info 的一部分，写入父节点 context.md
        # indirect_files 以 <<read>> 块形式写入

    else:
        # 分解模式：LLM将goal分解为子任务，串行递归执行
        # 每个子任务的goal.md包含四段：做什么、输出要求、输出用途、后续兄弟任务
        subgoals = decompose(context, goal)
        for subgoal in subgoals:
            meta_agent(subgoal, depth+1)
            # 子任务完成后，其 verifier 结果写入父节点 context.md

    # 唯一的信息流动：无论成败，observation/direct_info 写入父节点 context.md
    if depth == 0:
        write_results(observation)  # 根节点例外
    else:
        append_to_parent_context(direct_info, indirect_files)
```

---

## 信息提取机制

### verifier 职责（第二轮改动）

**新职责**：
- 从 observation（script 的 stdout）中识别对后续任务有直接帮助的信息
- 区分直接信息和间接信息
- 把直接信息整理后写入父节点 context.md
- 把间接信息以 `<<read>>` 块形式写入父节点 context.md

**直接信息**：code_generator 拿到后可以直接写进 script 使用，不需要额外读取或查询。例如：
- 脚本的具体调用方式和参数
- 已解析出的配置值、关键词列表
- API 的具体参数格式
- 任何可以直接复制进 script 的具体数据
- 失败信息（失败原因、错误详情）

**间接信息**：指向信息存储位置的指针，需要再次读取才能获得直接信息。例如：
- 文件路径（`结果写入了 data/selected_papers.json`）
- 目录位置（`配置在 AGENT.md 里`）

### `<<read>>` 间接信息机制（第二轮改动）

**设计概述**：
- 间接信息（文件路径）通过 `<<read>>` 块写入父节点 context.md
- probe 阶段自动解引用为直接信息，避免触发额外的 meta_agent 调用

**解引用逻辑**：
1. **情况一：文件不存在**
   ```
   <<read:error>> data/raw_papers.json 不存在 <<read/>>
   ```
2. **情况二：文件在预算内**
   ```
   # data/raw_papers.json
   （完整文件内容）
   ```
3. **情况三：文件超出剩余 context 预算**
   ```
   # data/raw_papers.json
   [截断：仅显示前 N tokens，文件共 M tokens]
   （截断范围内的文件内容）
   [如需读取更多，可创建子任务：读取 offset=N 之后的部分，替换父节点 context.md 中本段内容]
   ```

**续读阶段**：
- LLM 判断截断内容不够用时，主动创建子任务
- 子任务完成后，用读取到的内容**精确替换**父节点 context.md 中对应的截断块

---

## script.py 与 LLM 调用

**script.py** 以标准 Python 运行，不注入 read/write/bash/llm_call。脚本内可直接使用 `open()`、`subprocess`、`os`、`pathlib` 等，按需 `import`。执行器仅注入变量 **goal_dir**（当前节点目录的绝对路径），并将当前工作目录设为 goal_dir，故相对路径均相对于当前节点。若需调用 LLM，使用环境变量 `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL` 与 `openai`/`requests` 即可。

**meta-agent 内部**（决策、分解、代码生成、验证）仍通过 `primitives.make_primitives(...)["llm_call"]` 调用 LLM，接口保持单一随机性入口；token 预算、trace 记录等逻辑不变。llm_call 的 **role** 参数：`default` / `coder` / `verifier` / `planner`。

---

## 文件系统结构

```
{workDir}/
├── .agent/                          # 公共工作区，全局可读写（权限控制）
│   ├── trace.jsonl                  # 全局追踪，记录节点级引用
│   ├── terminal.md                  # 全局执行日志，一级检索入口
│   ├── state.jsonl                  # 全局状态流水，追加写
│   ├── AGENT.md                     # 全局配置，根节点约束，子节点继承
│   └── sessions/                   # 每次运行摘要索引
│
└── {goal}/                          # 根节点，对应用户原始问题
    ├── goal.md                      # 任务描述，只读，由父节点或用户写入
    ├── context.md                   # probe 阶段收集的信息 + 子节点 observation
    ├── script.py                    # 解决当前任务的可执行脚本
    ├── results.md                   # 根节点最终输出，供用户查看（非根节点无此文件）
    ├── permissions.json             # 根节点权限配置（子节点向上查找）
    └── {N_subgoal}/                # 子节点，带数字编号前缀（如 1_read_config, 2_process_data）
        ├── goal.md                  # 包含四段：任务、输出要求、输出用途、后续兄弟任务
        ├── context.md
        ├── script.py
        └── ...                       # 子节点不持有 permissions.json，向上查找
```

**非根节点不再有 results.md 和 meta.json**，简化了状态管理。

**子任务名称验证**：当 LLM 返回子任务列表时，系统会自动验证和清理子任务名称，确保它们是有效的目录名。规则如下：
- 只允许字母、数字、下划线、连字符
- 空格会被替换为下划线
- 特殊字符（斜杠、冒号、星号等）会被移除
- 前后空白会被移除
- 空名称会生成默认名称
- 名称会被截断到 64 字符以避免超长路径问题

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

# [decompose]
max_depth: 4

# [learned_patterns]
// 人工写入，Agent 只读，Probe 阶段注入 context
```

按调用类型只注入相关 section，不全量注入。

---

## meta-agent 核心 Loop

meta-agent 是一个递归函数，接口极简：输入一个目录，输出到父节点 context.md（根节点输出到 results.md）。

```python
def meta_agent(goal_dir, depth=0):
    goal        = read(f"{goal_dir}/goal.md")
    permissions = load_permissions(goal_dir)

    # 1. Probe：以最小代价理解任务形状
    context = probe(goal_dir, goal, permissions, depth)

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
        result = execute_with_verification(goal_dir, goal, context, permissions, logger, depth)
        observation = result.observation
        direct_info = result.direct_info
        indirect_files = result.indirect_files

    # 3b. 分解
    elif decision_type == 'decompose':
        execute_decompose(goal_dir, goal, decision.subtasks, depth, permissions, logger)
        # 子节点执行后，其 verifier 结果写入父节点 context.md

    # 4. 唯一的信息流动：无论成败，observation/direct_info 写入父节点 context.md
    if depth == 0:
        write_results(goal_dir, observation)  # 根节点例外
    else:
        append_to_parent_context(parent_dir, subtask_name, direct_info, indirect_files)
```

### Probe

```python
def probe(goal_dir, goal, permissions, depth):
    # 确定性操作：获取目录结构
    tree = bash(f"find {goal_dir} -maxdepth 2 -type f | head -40")
    
    # 读取固定候选文件（确定性规则）
    parts = []
    parts.append(f"# Directory structure\n{tree}")
    
    # 父节点 context（仅 depth > 0，读取时去重）
    if depth > 0:
        parent_context = read(f"{goal_dir}/../context.md")
        # 去除公共部分：Directory structure、Allowed external directories
        parent_context = _dedupe_parent_context(parent_context)
        parts.append(f"# Parent context\n{parent_context}")
        
        # 读取父节点 goal.md 的"后续兄弟任务"段落
        parent_sibling_tasks = _extract_sibling_tasks(f"{goal_dir}/../goal.md")
        if parent_sibling_tasks:
            parts.append(f"# Parent's subsequent sibling tasks\n{parent_sibling_tasks}")
    
    context = "\n\n---\n\n".join(parts)
    
    # 解引用父节点 context.md 中的 <<read>> 块
    if depth > 0:
        context = _resolve_read_blocks(parent_context, context, goal_dir)
    
    write(f"{goal_dir}/context.md", context)
    return context
```

Probe 是每个节点执行的第一步，**退化为纯确定性操作**。不再调用 LLM 决定读取哪些文件，而是按固定规则读取：goal.md（当前节点）、../context.md（父节点，仅 depth > 0）。读取父节点 context 时**自动去重**，去除目录结构、Allowed external directories 等公共部分，避免深层节点 context 膨胀。

**第二轮改动**：probe 增加了两个关键功能：
1. 读取父节点 goal.md 的"后续兄弟任务"段落，追加到当前 context.md，使当前 verifier 能感知到更上层的后续任务需求
2. 解引用父节点 context.md 中的 `<<read>>` 块，将文件路径自动转换为文件内容

### 直接执行

- **代码生成**：由 `prompts/code_generator.md` 驱动，要求模型**同时输出**一段 Python 脚本（`\`\`script` 块）和执行计划（`\`\`plan` 块），禁止 `<tool_code>` 等工具调用标记。脚本使用**标准 Python**（open、subprocess、os 等），执行器仅注入 **goal_dir** 并将当前工作目录设为 goal_dir。根据 goal.md 中的「输出要求」，**主动 print 对应信息**作为 observation。
- **验证**：执行 script 后，通过 `prompts/verifier.md` 调用 verifier LLM 提取 direct_info 和 indirect_files。不再进行 pass/fail 判断。
- **信息流动**：verifier 提取的 direct_info 和 indirect_files 由执行器写入父节点 context.md。失败信息也是 direct_info 的一部分。
- **脚本执行**：在**子进程**中通过 `script_runner.py` 执行 `script.py`（仅注入 goal_dir 并 chdir 到 goal_dir），子进程崩溃或超时不会拖垮主进程。子进程的 **stdout 完整捕获**作为 observation。
- **script.py 输出规范**：script.py 是纯执行者，只 print 可观测的事实。使用结构化标记：
  - `[DONE] <完成的操作描述>` - 每次文件读写或解析操作后输出
  - `[FAILED] <失败的操作描述>` - 操作失败时输出
  - `[DATA:<label>] <<<\n<完整数据内容>\n>>>` - 输出完整的中间数据
  - **根据「输出要求」print 对应的输出信息**

### 分解执行

```python
def execute_decompose(goal_dir, goal, subtasks, depth, permissions):
    # 创建子节点目录
    for subtask in subtasks:
        subdir = f"{goal_dir}/{subtask.name}"
        bash(f"mkdir -p {subdir}")
        # 每个子任务的 goal.md 包含四段：任务、输出要求、输出用途、后续兄弟任务
        write(f"{subdir}/goal.md", subtask.description)
    
    # 确定性依赖校验
    validated = validate_dependencies(subtasks)

    # 按拓扑序串行执行子节点
    levels = get_execution_levels(validated)
    for level_tasks in levels:
        for task in level_tasks:
            subdir = f"{goal_dir}/{task.name}"
            # 子节点执行后，verifier 结果自动写入父节点 context.md
            meta_agent(subdir, depth + 1)
```

**子任务 goal.md 的四段式结构（第二轮改动）**：

```markdown
## 任务
（做什么）

## 输出要求
（需要输出什么，具体到信息粒度）

## 输出用途
（哪个后续任务会消费这个输出，用来做什么）

## 后续兄弟任务
（当前任务完成后，接下来还有哪些任务，每个任务一行简要描述；
  verifier 结合此信息判断哪些 observation 对后续任务有直接帮助）
```

### context 去重优化

1. **probe 阶段**：读取父节点 context 时，自动去除公共部分（目录结构、Allowed external directories），只保留子任务 observation。
2. **追加 observation**：写入父节点 context 时，逐行去重，避免完全匹配的重复行。
3. **解引用 `<<read>>` 块**：probe 阶段自动将文件路径解引用为文件内容，支持截断处理。

---

## 全局记录

### trace.jsonl（节点级引用）

```jsonl
{"ts": 1000, "seq": 1, "kind": "node_start",     "node": "goal/subgoal-a"}
{"ts": 1001, "seq": 2, "kind": "llm_call",        "node": "goal/subgoal-a", "prompt_tokens": 1200, "output_tokens": 340}
{"ts": 1002, "seq": 3, "kind": "node_completed",  "node": "goal/subgoal-a"}
{"ts": 1003, "seq": 4, "kind": "node_failed",     "node": "goal/subgoal-b", "error": "..."}
```

Trace 只记录节点级事件和引用，不重复存储内容。需要详情时通过 node 路径跳转到节点目录读取 context.md。

### terminal.md（一级检索）与调试编号

每一级目标在终端显示时会在名称前加上**当前层内的序号**（如 `1. prepare_directories`、`2. fetch_cv_papers`），便于调试与对号入座。根目标显示为 `1. {goal_name}`，子层内按执行顺序为 1、2、3…

```markdown
📍 [seq=1] 1. survey_xxx 开始执行
📍 [seq=2] 1. prepare_directories 开始执行
📍 [seq=3] 1. prepare_directories 完成
📍 [seq=4] 2. fetch_cv_papers 开始执行
⚠️  [seq=5] 2. fetch_cv_papers 失败 → ...
📍 [seq=6] 1. survey_xxx 完成
```

terminal.md 是人类可读的执行流水账，作为一级检索入口。📍 标记关键事件，⚠️ 标记失败，按需跳转到节点目录下钻。

### state.jsonl（全局状态流水）

```jsonl
{"ts": ..., "seq": 1, "event": "session_start",    "root": "goal/",      "session_id": "uuid"}
{"ts": ..., "seq": 2, "event": "depth_exceeded",   "node": "goal/a/b/c", "depth": 4}
{"ts": ..., "seq": 3, "event": "session_complete", "results": "goal/results.md"}
```

state.jsonl 追加写，跨 Session 累积，不清空。

---

## 永远不要做的事

- 修改 meta-agent 内部 llm_call 的接口签名
- 不定义终止条件（max_depth 是硬性约束，不可省略）
- 让子节点写父节点的目录（跨节点只读不写）
- 在 LLMCall 内部做权限决策（权限校验是确定性逻辑）
- 非根节点写入 results.md（results.md 只存在于根节点）
- 在 script.py 执行过程中截断 LLMCall（预算不足在 Probe 阶段提前处理）
- 让 Agent 自动修改 AGENT.md（优化建议必须经人工审核）

---

## 一句话总结

> meta-agent 是一个递归函数：probe 退化为确定性操作，决策直接解决或分解子任务。LLMCall 生成 script + plan，执行直接解决模式：后 script 的完整 stdout 作为 observation，verifier 提取 direct_info 和 indirect_files，失败信息也作为 direct_info 写入父节点 context.md。分解执行模式：递归执行子节点，每个子节点完成后 verifier 结果立即追加到父节点 context.md。引入 `<<read>>` 间接信息机制，probe 阶段自动解引用文件路径，支持截断处理避免 context 膨胀。信息流只有一个方向：子节点完成后写入父节点 context.md，根节点例外写入 results.md 供用户查看。

---

## 测试结果

### 核心功能实现

1. **script.py 标准 Python 执行**：仅注入 goal_dir，脚本使用 open/subprocess/os 等；meta-agent 内部 llm_call 用于决策/分解/生成/验证 - 已实现并测试
2. **meta_agent 核心递归函数**: 已实现
3. **probe 函数**: 已实现（退化为确定性操作，带去重优化，支持 `<<read>>` 块解引用）
4. **依赖校验层**: 实现了缺失依赖检测和循环依赖检测
5. **串行执行**: 按拓扑序逐节点执行
6. **全局记录**: trace.jsonl, terminal.md, state.jsonl（终端中每级目标名前带序号便于调试）
7. **权限控制**: permissions.json 向上查找机制
8. **script 子进程执行**: 通过 `src/script_runner.py` 在子进程中执行 script.py，隔离崩溃；stdout 完整作为 observation
9. **四段式子任务描述**: 子任务 goal.md 包含任务、输出要求、输出用途、后续兄弟任务四部分（第二轮改动）
10. **verifier 信息提取**: verifier 不再判断 pass/fail，改为提取 direct_info 和 indirect_files（第二轮改动）
11. **`<<read>>` 间接信息机制**: probe 阶段自动解引用，支持截断处理（第二轮改动）
12. **信息流**: 子节点 verifier 结果写入父节点 context.md，根节点写入 results.md
13. **统一信息流处理**: meta_agent 末尾统一处理 append_to_parent_context / write_results
14. **context 去重优化**: probe 读取父节点时去除公共部分，追加 observation 时逐行去重

### 自定义 Prompt

所有 LLM 调用的 prompt 都已抽离到 `prompts/` 目录下的 `.md` 文件中。用户可以通过修改这些文件来自定义模型行为，无需修改代码。

#### prompts 目录结构

```
prompts/
├── system_prompt.md     # 系统级 prompt，基础角色定义（决策/分解等用）
├── code_generator.md   # 代码生成 prompt（直接执行）：同时输出 script + plan、要求 print 标记输出
├── decision.md         # 决策 prompt（直接解决还是分解）
├── decomposer.md       # 任务分解 prompt（四段式结构：任务、输出要求、输出用途、后续兄弟任务）
└── verifier.md        # 验证器 prompt（提取 direct_info 和 indirect_files，第二轮改动）
```

#### 如何自定义

1. **修改系统 prompt**: 编辑 `prompts/system_prompt.md` 可以改变模型的基础角色定义
2. **修改特定行为**: 
   - 修改 `prompts/decision.md` 可以改变任务分解策略
   - 修改 `prompts/decomposer.md` 可以改变子任务生成方式（现在包含后续兄弟任务信息）
   - 修改 `prompts/code_generator.md` 可以改变代码生成风格与输出要求策略
   - 修改 `prompts/verifier.md` 可以改变结果验证/信息提取逻辑（第二轮改动后不再返回 pass/fail）

prompt 模板使用 Python 格式化字符串语法，变量用 `{}` 包裹。例如 `{goal}`、`{context}` 等。

### 入口使用

```bash
# 正常运行
python main.py --goal-dir ./my_task
```
