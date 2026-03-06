# Meta-Agent 修改清单

P1 是已确认的新行为尚未实现，P2 是架构优化。

---

### [P1-2] 子节点部分失败时父节点 retry 失败子任务（executor.py）

**现状**：`execute_decompose` 发现子节点 escalated 直接 `return`，丢弃已完成子节点的结果。

**修改**：发现某子节点 escalated 时，不立即 return，而是：

1. 记录失败的子任务名
2. 以**已完成子节点的 results 作为 context** 重新调用 `meta_agent` 执行失败子任务（最多 MAX_RETRY 次）
3. 重试仍失败，才向上 escalate

```python
for task in level_tasks:
    subdir = os.path.join(goal_dir, task["name"])
    results = parse_results_content(open(results_path).read())
    if results.get("status") == "escalated":
        retry_count = read_meta(subdir).get("retry_count", 0)
        if retry_count < MAX_RETRY:
            update_meta(subdir, retry_count=retry_count + 1)
            meta_agent(subdir, depth + 1)  # 重试，此时 context.md 包含兄弟节点结果
        else:
            write_results_escalated(goal_dir, f"Subtask {task['name']} failed after retries")
            return
```

---

### [P1-3] execute_with_verification 改为马尔可夫结构，删除 needs_exploration（executor.py）

**现状**：history 累积所有历史，needs_exploration 状态绕过重试计数可无限循环。

**修改**：

1. **删除 needs_exploration 状态**。信息不足时，LLM 在 script.py 里主动调用 `bash`/`read` 探索，或通过 decision 阶段选择 decompose 拆出探索子任务。

2. **history 退化为只保留上一时刻**：`last_script`、`last_feedback`、`last_revised_goal`，不累积。

3. **保留 original_goal**，`code_generator` prompt 同时注入 `original_goal` 和 `current_revised_goal`，防止目标漂移。

4. **revised_goal 不写文件**，只作为下一次 code_generator prompt 的注入变量，`goal.md` 始终保持原始用户意图。

```python
original_goal = goal
last_script, last_feedback, last_revised_goal = "", "", ""

for attempt in range(MAX_VERIFY_RETRY):
    current_goal = last_revised_goal or original_goal

    prompt = code_gen_template.format(
        original_goal=original_goal,
        current_goal=current_goal,
        last_script=last_script,
        last_feedback=last_feedback,
        goal_dir=goal_dir,
        context=context,
    )

    script, plan = parse_script_plan(llm_call(..., prompt))
    console = execute_script(...)
    verification = verifier_llm_call(original_goal, plan, script, console)

    if verification["pass"]:
        return

    last_feedback = verification["feedback"]
    last_revised_goal = verification.get("revised_goal") or current_goal
    last_script = script  # 保留上一版 script 作为参考
```

---

### [P1-4] 合并 verifier + revise 为一次 llm_call（executor.py + prompts/verifier.md）

**现状**：verifier 和 revise 是两次独立的 llm_call，revise 看不到 script 和执行结果。

**修改**：合并为一次调用，输出格式：

```json
{
  "pass": true/false,
  "feedback": "具体哪里不对，指出是哪几行代码的问题",
  "revised_goal": "修订后的 goal（不需要修订时为 null）"
}
```

verifier prompt（`prompts/verifier.md`）里注入：`original_goal`、`plan`、`script`、`console_output`，要求同时输出以上三个字段。删除 `prompts/revise.md`。

---

### [P1-5] script.py 输出格式标准化（prompts/code_generator.md）

**修改**：在 `code_generator` prompt 里明确要求 script.py 在末尾写入结构化输出：

```
RESULT: 一句话说明完成了什么或失败原因
OBSERVATIONS:
- 执行过程中发现的环境事实（文件路径、API 格式、工具行为等）
- 对后续任务有用的信息写在这里
```

成功和失败都必须输出这个结构，verifier 依赖它来判断 pass/fail。

---

### [P1-6] merge_results 保留 observations 区块（executor.py）

**现状**：`merge_results` 只保留 result 区块，observations 丢失。`parse_results_content` 不解析 observations。

**修改**：

1. `parse_results_content` 新增解析 `--- observations ---` 区块，存入 `out["observations"]`。

2. `merge_results` 每个子节点保留 result + observations，丢弃 console：

```python
merged_content += f"## Subtask: {item['subtask']}\n"
merged_content += f"Status: {item['status']}\n\n"
if item.get("result"):
    merged_content += f"--- result ---\n{item['result']}\n\n"
if item.get("observations"):
    merged_content += f"--- observations ---\n{item['observations']}\n\n"
# console 不向上传递
```

---

### [P1-7] permissions.json 改为根节点单例，子节点向上查找（permissions.py + executor.py）

**现状**：每个子节点创建时都写一份 permissions.json。

**修改**：

1. `load_permissions(node_dir)` 改为向上遍历目录树，找到第一个存在 `permissions.json` 的目录即停止，找到根目录为止。

```python
def load_permissions(node_dir: str) -> dict:
    current = os.path.abspath(node_dir)
    while True:
        perm_path = os.path.join(current, "permissions.json")
        if os.path.exists(perm_path):
            with open(perm_path) as f:
                return json.load(f)
        parent = os.path.dirname(current)
        if parent == current:  # 到达文件系统根
            return {}
        current = parent
```

2. `execute_decompose` 里删除给每个子节点写 permissions.json 的逻辑。

---

## P2：架构优化

### [P2-1] error.md 合并进 results.md，不再单独存文件（executor.py + recovery.py）

**现状**：失败时同时写 `error.md` 和 `results.md`（escalated）。recovery 里有 `if os.path.exists(error_path)` 检查。

**修改**：

1. 失败信息完整写入 `results.md` 的 console 区块，删除单独写 `error.md` 的逻辑。

2. `recovery.py` 改为只读 `results.md` 的 status 字段判断失败，读 console 区块获取错误信息，删除所有 `error_path` 相关检查。

3. `execute_with_verification` 的第二次进入（retry）时，error 信息从 `results.md` 的 console 区块读取，注入 code_generator prompt。

---

### [P2-2] plan.md 不落盘，作为内存变量传递（executor.py）

**现状**：`execute_with_verification` 把 plan 写入 `plan.md`。

**修改**：plan 只作为局部变量，在 `execute_with_verification` 函数内传递给 verifier，不写文件。删除所有 `plan_path` 写文件逻辑。

---

### [P2-3] llm_call system prompt 按调用类型分化（primitives.py）

**现状**：所有 llm_call 共用 `"You are a helpful assistant."` 作为 system prompt。

**修改**：`llm_call` 新增可选参数 `role: str = "default"`，根据 role 选择对应的 system prompt：

- `"coder"`：强调输出格式为代码块，禁止解释性文字
- `"verifier"`：强调输出 JSON，严格按 schema
- `"planner"`：强调结构化决策输出

各调用点传入对应 role。prompts/ 目录下各 .md 文件配套更新。

---

### [P2-4] context.md 生命周期明确（probe.py）

**现状**：context.md 每次 probe 时覆盖写入，子节点读到的 `../context.md` 是父节点最新一次 probe 的结果。

**行为确认**（无需代码改动，只是明确约定）：
- context.md 在每次 `meta_agent` 调用时由 probe 覆盖写入，这是预期行为
- 子节点读到的 `../context.md` 是父节点最新的 context，信息更新而不是历史快照
- context.md **不删除**，因为子节点需要读取

---

## 修改涉及的文件汇总

| 文件 | 涉及改动 |
|------|---------|
| `primitives.py` | P0-1（删 stop tokens）、P2-3（system prompt 分化） |
| `executor.py` | P0-2、P0-3、P1-2、P1-3、P1-4、P1-6、P2-1、P2-2 |
| `probe.py` | P1-1（退化为确定性） |
| `recovery.py` | P0-2（decomposition_id 校验生效）、P2-1（读 results.md 代替 error.md） |
| `permissions.py` | P1-7（向上查找） |
| `agent.py` | P1-3（传入 original_goal）、P1-7（不再写子节点 permissions） |
| `prompts/verifier.md` | P1-4（合并 revise，新增输出字段） |
| `prompts/revise.md` | P1-4（删除此文件） |
| `prompts/code_generator.md` | P1-3（注入 original_goal / last_script / last_feedback）、P1-5（要求 OBSERVATIONS 输出） |
| `prompts/file_probe.md` | P1-1（probe 不再调用 LLM，此文件可删除） |