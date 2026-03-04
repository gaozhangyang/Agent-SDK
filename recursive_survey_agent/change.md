# Change Request: 移除并行执行，改为拓扑序串行 + 简化 Recovery

## Prompt for OpenCode

> 对 recursive-meta-agent 代码做以下重构：移除所有子节点并行执行逻辑（ThreadPoolExecutor 及相关并发代码），改为拓扑排序后串行逐个调用 `meta_agent(subdir, depth+1)`。同时简化 Recovery 逻辑，去掉并发相关的保护措施。以下是具体的修改清单，请逐条执行。

---

## 修改清单

### 1. `execute_by_dependency` → 串行拓扑执行

**文件**: 包含 `execute_by_dependency` 函数的模块

**改动**:
- 移除 `ThreadPoolExecutor`、`concurrent.futures` 等所有并发相关 import
- 移除 future 收集、线程池管理、并发异常聚合逻辑
- 改为简单的 for 循环：对拓扑排序结果逐个调用 `meta_agent(subdir, depth+1)`

**目标代码结构**:

```python
def execute_by_dependency(validated_subtasks, goal_dir, depth):
    """按拓扑序串行执行子节点"""
    ordered = topological_sort(validated_subtasks)
    for subtask in ordered:
        subdir = f"{goal_dir}/{subtask.name}"
        meta_agent(subdir, depth + 1)
```

**注意**: 保留 `topological_sort` 和 `validate_dependencies`，它们决定正确的执行顺序，与并行无关。

---

### 2. `execute_decompose` 中的调用方式

**文件**: 包含 `execute_decompose` 函数的模块

**改动**:
- 移除注释中所有关于"并发""并行""concurrent"的表述
- `execute_by_dependency` 调用本身不变，但确保它内部已改为串行
- 确认子节点失败时异常会直接向上抛出，不再需要聚合多个 future 的异常

---

### 3. Recovery 逻辑简化

**文件**: 包含 `recover` 函数的模块

**改动**:
- 移除任何与并发写入相关的锁（如果有对 trace.jsonl / terminal.md / state.jsonl 的写锁）
- 移除并发安全的追加写逻辑（如 file lock、atomic write），改为普通的 append 写入
- `recover` 函数内部已经是 `for node in topological_order(nodes)` 的串行循环，确认没有残留的并行恢复分支

**确认点**: Recovery 的核心逻辑（扫描树 → 检查 decomposition_id → 判断重试/escalate → 重新执行）不需要改动，只清理并发保护层。

---

### 4. 全局记录写入简化

**文件**: trace.jsonl / terminal.md / state.jsonl 的写入模块

**改动**:
- 串行执行下 seq 天然有序，移除任何用于保证并发写入顺序的机制（如 atomic counter、lock）
- seq 可以用简单的自增变量，不需要线程安全的计数器
- 如果有 `threading.Lock` 保护写入，移除

---

### 5. 清理 import 和依赖

**全局扫描**:
- 移除所有文件中的 `import concurrent.futures`、`from concurrent.futures import ThreadPoolExecutor`
- 移除 `import threading`（如果仅用于并发保护）
- 移除 `requirements.txt` 或 `pyproject.toml` 中与并发相关的额外依赖（如果有）

---

### 6. 设计文档同步更新

**文件**: 设计文档 / README

**改动**:
- `execute_decompose` 伪代码中的注释 `# 按依赖关系执行，无依赖关系的子节点可并发` 改为 `# 按拓扑序串行执行子节点`
- 测试结果部分 `并发执行：使用 ThreadPoolExecutor 实现` 改为 `串行执行：按拓扑序逐节点执行`
- 移除文档中所有关于"并行""并发"的措辞

---

## 不动的部分

以下逻辑与并行无关，**不要修改**：

- `topological_sort` — 串行也需要正确的执行顺序
- `validate_dependencies` — 依赖校验（缺失检测 + 循环检测）仍然必要
- `decomposition_id` 校验 — Recovery 核心逻辑
- `error.md` 写入与读取 — 错误处理不变
- `escalate` 机制 — 与并发无关
- 四个原语的接口 — 永不修改


最后完成工作之后要更新相关的README.md文档，使得项目状态与描述一致。
