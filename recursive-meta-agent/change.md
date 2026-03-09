# Change List

## 1. 修复：深度限制时仍执行 probe

**文件：** `agent.py`

**问题：** `depth >= max_depth` 时直接跳过 probe，导致 coder 拿到空 context 执行。

**修改：** 将 `probe()` 调用移到深度判断之前，深度限制只影响 planner 决策，不影响 context 构建。

```python
# Before
if depth >= max_depth:
    decision_type = "direct"
else:
    context = probe(...)
    decision_type = _make_decision(...)

# After
context = probe(...)
if depth >= max_depth:
    decision_type = "direct"
else:
    decision_type = _make_decision(...)
```

---

## 2. 修复：合并 decision + decompose，消除冗余 LLM 调用

**文件：** `agent.py`, `prompts.py`

**问题：** `_make_decision()` 拿到 decompose 决策后丢弃了 subtasks，`_get_subtasks()` 再用 decomposer prompt 重新生成一遍，多一次 LLM 调用。

**修改：**
- `_make_decision()` 返回值从 `str` 改为 `dict`，同时携带 `type` 和 `subtasks`
- 删除 `_get_subtasks()` 函数
- `decomposer.md` 的四段式 description 规范（任务/输出要求/输出用途/后续兄弟任务）合并进 `decision.md`
- `agent.py` 调用处对应调整

---

## 3. 新增：`initial_context` 参数支持上层 workflow 预构建 context

**文件：** `agent.py`, `probe.py`

**问题：** 当前通过检测 `context.md` 是否已存在来隐式复用 context，语义不清晰，调用方需要了解这个文件系统约定。

**修改：**
- `meta_agent()` 新增 `initial_context: Optional[str] = None` 参数
- probe 逻辑改为：`context = initial_context or probe(goal_dir)`
- 删除 `probe.py` 中 `depth == 0 and os.path.exists(context_path)` 的隐式复用分支

---

## 4. 重命名：verifier → observer

**文件：** `executor.py`, `prompts.py`, `verifier.md`

**原因：** verifier 暗示"做判断"，实际职责是从 console output 中提取信息，observer 更准确。

**修改：**
- `verifier.md` 重命名为 `observer.md`
- `executor.py` 中所有 `verifier` 相关变量名、函数名改为 `observer`
- `parse_verifier_response()` 改名为 `parse_observer_response()`
- `prompts.py` 中 `get_verifier_prompt()` 改名为 `get_observer_prompt()`

---

## 5. 删除：logger 中的 trace/state/terminal 写入行为

**文件：** `logger.py`，以及所有调用 `log_trace`、`log_state`、`log_terminal` 的地方

**修改：**
- 删除 `log_trace()`、`log_state()`、`log_terminal()` 方法及其实现
- 删除 `state.jsonl`、`trace.jsonl`、`terminal.md` 的写入逻辑
- 清理 `agent.py`、`executor.py`、`probe.py` 中所有对上述方法的调用

---

## 6. 删除：decomposer.md 和 `_get_subtasks()`

**文件：** `agent.py`, `prompts.py`, `decomposer.md`

**原因：** 条目 2 完成后，decomposer.md 和 `_get_subtasks()` 不再需要。

**修改：**
- 删除 `decomposer.md`
- 删除 `agent.py` 中的 `_get_subtasks()` 函数
- 删除 `prompts.py` 中的 `get_decomposer_prompt()`

---

## 7. 合并：`parse_script_plan()` 和 `parse_script()`

**文件：** `executor.py`

**问题：** `parse_script()` 是 `parse_script_plan()` 的子集，单独存在没有意义。

**修改：**
- 删除 `parse_script()`
- 所有调用 `parse_script()` 的地方改用 `parse_script_plan()`，取返回值的第一个元素

---

## 8. 统一：`sanitize_subtask_name()` 去重

**文件：** `executor.py`, `agent.py`

**问题：** 两处各有一份实现，逻辑相似但不完全一致。

**修改：**
- 保留 `executor.py` 中的实现作为唯一版本
- 删除 `agent.py` 中的重复实现（`_sanitize` 内部函数）
- `agent.py` 改为从 `executor` import `sanitize_subtask_name`

---

## 9. 提取：`indirect_files` 路径转换逻辑

**文件：** `executor.py`

**问题：** 相对路径转绝对路径的逻辑内联在 `execute_with_verification()` 函数体中，显得臃肿。

**修改：** 提取为独立函数 `_resolve_indirect_paths(paths: List[str], base_dir: str) -> List[str]`

---

## 10. 合并：`_parse_json()` 和 `_parse_subtasks()`

**文件：** `agent.py`

**问题：** 两个函数的 JSON 解析逻辑高度相似，只是期望的返回类型不同。

**修改：** 合并为 `parse_json_from_llm(text: str, expected_type: type) -> Optional[Any]`，用 `expected_type` 参数（`dict` 或 `list`）控制返回类型，删除原来两个函数。

重要：要严格测试修改的正确性，完成修改后要记得更新recursive-meta-agent和recursive_survey_agent的README.m使得项目状态和描述一致。