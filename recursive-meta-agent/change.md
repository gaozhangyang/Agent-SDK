# Meta-Agent 修改清单

> 来源：设计讨论，共8条变更。按模块分组，每条说明**改什么**、**怎么改**、**为什么**。

---

## 原则回顾

本次修改围绕三个核心方向：
1. **探索是目标，容错是机制**：把"信息不足"的处理从执行层移到决策层
2. **只有父子信息流**：删除兄弟节点横向依赖，父节点 context.md 作为信息中转池
3. **用 prompt 约束替代运行时补丁**：在 LLM 输入侧解决问题，不在解析层打补丁

---

## 变更1：合并 `execute_direct` 和 `execute_with_verification`

**文件**：`executor.py`

**改什么**：
- 删除 `execute_direct` 函数全部代码
- 所有调用 `execute_direct` 的地方改为调用 `execute_with_verification`
- `MAX_VERIFY_RETRY` 从 3 降到 2

**怎么改**：
```python
# 删除整个 execute_direct 函数

# MAX_VERIFY_RETRY 改为
MAX_VERIFY_RETRY = int(os.environ.get("MAX_VERIFY_RETRY", "2"))
```

**为什么**：两个函数高度重叠，`execute_direct` 是 `execute_with_verification` 的简化版。验证循环简化后只剩容错用途，保留一个函数即可。

---

## 变更2：删除死代码 `aggregate_results`

**文件**：`executor.py`、`prompts/aggregator.md`、`prompts/` 加载模块

**改什么**：
- 删除 `executor.py` 中的 `aggregate_results` 函数全部代码
- 删除 `prompts/aggregator.md` 文件
- 删除 `prompts/__init__.py`（或同等模块）中 `get_aggregator_prompt` 的导入和定义
- 删除 `executor.py` 顶部对 `get_aggregator_prompt` 的 import

**为什么**：`merge_results` 已完全替代 `aggregate_results`，后者是死代码，保留只增加维护负担。

---

## 变更3：简化 `permissions.json` 结构

**文件**：`permissions.json`（根节点）、`permissions.py`

**改什么**：
删除未被实际执行的 `read`/`write` 白名单字段，只保留真正生效的字段：

```json
{
  "max_depth": 4,
  "bash": {
    "network": false,
    "delete": false
  }
}
```

在 `permissions.py` 中同步删除对 `read`/`write` 白名单的解析和校验逻辑。

**为什么**：白名单在代码层面没有被强制执行，保留会造成"看起来有权限控制"的误导。简化为只保留真正有效的字段，更诚实，也更简单。

---

## 变更4：明确 `context.md` 的所有权和写入机制

**文件**：`probe.py`、`executor.py`（`execute_decompose` 函数）

**改什么**：

`context.md` 有且仅有两个写入时机，其他任何地方不得写入：

**时机1：probe 阶段初始化**（已有，格式保持不变）
```
# Initial Context
{目录结构}

# Parent Context
{../context.md 内容，仅 depth > 0}

# Memory Hints
{最近5条 memory}
```

**时机2：execute_decompose 中每个子节点完成后追加**

在 `execute_decompose` 的子节点执行循环里，每个子节点完成后立即执行：

```python
def _append_observations_to_parent_context(goal_dir: str, subtask_name: str) -> None:
    """把子节点的 OBSERVATIONS 追加到父节点的 context.md"""
    subdir = os.path.join(goal_dir, subtask_name)
    results_path = os.path.join(subdir, "results.md")
    context_path = os.path.join(goal_dir, "context.md")

    if not os.path.exists(results_path):
        return

    with open(results_path, "r", encoding="utf-8") as f:
        content = f.read()

    data = parse_results_content(content)
    observations = data.get("observations", "").strip()

    if not observations:
        return

    with open(context_path, "a", encoding="utf-8") as f:
        f.write(f"\n\n# From: {subtask_name}\n{observations}")
```

在 `execute_decompose` 的每层循环中，子节点执行完后立即调用：

```python
for task in level_tasks:
    subdir = os.path.join(goal_dir, task["name"])
    meta_agent(subdir, depth + 1, display_index=task_idx + 1)
    # 子节点完成后，把 OBSERVATIONS 追加到父节点 context.md
    _append_observations_to_parent_context(goal_dir, task["name"])
```

**为什么**：新设计只保留父子信息流，删除兄弟节点横向依赖。父节点的 `context.md` 作为动态信息池，下一个子节点通过 probe 自然继承前驱节点的输出。`depends_on` 退化为纯拓扑排序工具，不再用于直接文件读取。

---

## 变更5：`decomposition_id` 粒度降到子节点级别

**文件**：`executor.py`（`execute_decompose`）、`recovery.py`

**改什么**：

**executor.py**：创建子节点时，对每个子节点单独计算 hash，写入该子节点自己的 `meta.json`：

```python
import hashlib

# 创建子节点时
for subtask in subtasks:
    subdir = os.path.join(goal_dir, subtask["name"])
    subtask_hash = hashlib.md5(subtask["description"].encode()).hexdigest()
    
    meta = {
        ...
        "decomposition_id": subtask_hash,  # 只对自己的 description 算 hash
        ...
    }
```

删除父节点 `meta.json` 中写入 `decomposition_id` 的逻辑。

**recovery.py**：Recovery 校验改为比较子节点自己的 hash：

```python
# 旧逻辑：比较父节点的 decomposition_id
parent_decomp_id = get_parent_decomposition_id(node, goal_dir)
if meta['decomposition_id'] == parent_decomp_id: ...

# 新逻辑：比较子节点自己 description 的 hash
current_goal = read(f"{node}/goal.md")
expected_hash = hashlib.md5(current_goal.encode()).hexdigest()
if meta['decomposition_id'] == expected_hash: ...
```

**为什么**：原来对整个 subtasks 列表算 hash，任何子任务的变化都会让所有子节点结果作废。新粒度下，只有该子节点自己的目标描述变了，它的结果才作废，兄弟节点不受影响。

---

## 变更6：删除数据污染检测，改在 prompt 约束

**文件**：`executor.py`（`_merge_console_into_results`）、`prompts/code_generator.md`

**改什么**：

**executor.py**，删除 `_merge_console_into_results` 中的以下代码段：

```python
# 删除这整段
if result.strip().startswith(("[", "{")) and len(result.strip()) > 500:
    # 这表明 results.md 被意外覆盖为数据文件，需要重置为正确格式
    logger = get_logger()
    ...（整段删除）
```

**prompts/code_generator.md**，在输出格式约束部分增加：

```
## 输出格式硬性约束

script.py 写入 results.md 时，必须严格遵守以下格式，无一例外：

```
RESULT: 一句话说明完成了什么或失败原因

OBSERVATIONS:
- 对后续任务有用的环境事实（文件路径、接口格式、工具行为等）
- 每条以 "- " 开头
```

**严禁以下行为**：
- 将原始数据（JSON、列表、二进制）直接写入 results.md
- 数据文件必须写到其他路径（如 {goal_dir}/output/ 下），results.md 只写摘要
- 不得使用 import os / open() / subprocess 等直接操作文件系统，必须通过注入的原语
```

**为什么**：用启发式规则在解析层修复上游错误是补丁，不是解法。从 prompt 约束源头杜绝这类输出。

---

## 变更7：verifier 删除 `revised_goal`，只做 pass/fail

**文件**：`executor.py`（`parse_verifier_response`、`execute_with_verification`）、`prompts/verifier.md`

**改什么**：

**prompts/verifier.md**，修改输出格式，删除 `revised_goal` 字段：

```
输出严格为 JSON，格式如下，不包含其他内容：
{
  "pass": true 或 false,
  "feedback": "失败原因的简短描述，pass 为 true 时留空"
}
```

**executor.py**，`parse_verifier_response` 简化：

```python
def parse_verifier_response(llm_output: str) -> dict:
    # ... 解析逻辑不变，但返回值去掉 revised_goal ...
    return {
        "pass": result.get("pass", False),
        "feedback": result.get("feedback", ""),
        # 删除 "revised_goal": ...
    }
```

**executor.py**，`execute_with_verification` 中删除所有 `revised_goal` 相关逻辑：

```python
# 删除
last_revised_goal = ""
current_goal = last_revised_goal or original_goal
revised_goal = verification.get("revised_goal")
last_revised_goal = revised_goal or current_goal

# 简化后，循环只维护两个变量
last_script = ""
last_feedback = ""
```

**为什么**：`revised_goal` 的存在是为了引导重试方向，但重试次数降到2、且只处理偶发错误后，直接把 `feedback` 注入下一轮 prompt 就足够了。删掉可以简化 verifier prompt、解析逻辑和循环状态。

---

## 变更8：`code_generator.md` 明确四个原语的约束

**文件**：`prompts/code_generator.md`

**改什么**，在 prompt 开头增加原语说明区块：

```
## 可用原语（唯一允许的操作接口）

以下四个原语已注入到脚本运行环境，直接调用即可，无需 import：

read(path: str) -> str
    读取文件内容。可读取任意有权限的路径，包括父节点的 context.md。

write(path: str, content: str) -> None
    写文件。只能写当前节点目录（{goal_dir}）内的路径，不得写父节点或兄弟节点目录。

bash(command: str) -> str
    执行 shell 命令，返回完整输出。

llm_call(context: str | list, prompt: str, role: str = "default") -> str
    调用 LLM。role 可选：default / coder / verifier / planner。

## 严格禁止

- 禁止 import os、import subprocess、open()、pathlib 等直接文件系统操作
- 禁止写当前节点目录以外的路径
- 禁止将原始数据直接写入 results.md（见输出格式约束）

## OBSERVATIONS 的写作原则

OBSERVATIONS 面向下游依赖任务，写作时问自己：
"如果另一个任务依赖我的输出，它最需要知道什么？"

好的 OBSERVATIONS 示例：
- skill_x 的调用方式：bash("skill_x --input {file} --output {dir}")
- 输出文件路径：{goal_dir}/output/result.json
- 注意：输入必须是 UTF-8 编码，输出目录需预先存在

坏的 OBSERVATIONS 示例：
- 任务完成了（废话，不包含可用信息）
- 见上方结果（没有提炼，让下游自己去找）
```

**为什么**：LLM 生成的 script 可能用错原语参数，或绕过原语直接操作文件系统。在 prompt 里明确签名和禁止项，比在运行时检测更根本。OBSERVATIONS 写作原则对应变更4，确保信息流传递的质量。

---

## 变更9：decision prompt 增加 context 充分性评估

**文件**：`prompts/decision.md`

**改什么**，在决策 prompt 里增加 context 评估维度：

```
## 决策标准

在返回 "direct" 之前，先评估以下问题：
1. 我是否清楚完成这个目标需要哪些具体信息（文件路径、接口格式、工具用法）？
2. 这些信息是否已经在 context 中？

如果两个问题都是"是"，返回 "direct"。

如果有信息缺口，返回 "decompose"，并把探索步骤作为第一个子任务：
{
  "type": "decompose",
  "subtasks": [
    {
      "name": "explore_environment",
      "description": "具体说明需要探索什么、期望获得什么信息",
      "depends_on": []
    },
    {
      "name": "execute_main_task",
      "description": "主任务描述",
      "depends_on": ["explore_environment"]
    }
  ]
}

## 关键原则

不要用"先试试看"代替"先想清楚"。
如果预见到需要两步完成（先探索，再执行），直接分解，不要寄希望于重试。
```

**为什么**：这是改变1的落地。让 LLM 在决策阶段就识别"信息不足"，通过分解解决，而不是在执行层循环撞墙。`explore_first` 本质上是 `decompose` 的特例，不需要新增决策类型。

---

## 执行顺序建议

1. 变更2（删死代码）—— 最简单，先清理
2. 变更1（合并函数）
3. 变更7（简化 verifier）
4. 变更3（简化 permissions）
5. 变更5（decomposition_id 粒度）
6. 变更4（context.md 所有权）—— 需要同时改 probe.py 和 executor.py
7. 变更6（删补丁）+ 变更8（code_generator prompt）—— 成对处理
8. 变更9（decision prompt）—— 最后处理，依赖前面的结构稳定

---

## 重要

完成任务后需要更新README.md(只做必要修改)