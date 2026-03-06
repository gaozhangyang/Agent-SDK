# Prompt：用 Python 实现 L1 级别的 meta-agent

## 任务

请阅读下面的设计文档recursive-meta-agent/meta-agent.md,在recursive-meta-agent目录，用 Python 实现 L1 级别的 meta-agent。



---

## 实现要求

### 项目结构

```
recursive-meta-agent/
├── main.py                      # 入口，接收 goal_dir 参数启动 meta-agent
├── src/
│   ├── agent.py                 # meta_agent() 核心递归函数
│   ├── primitives.py            # 四个原语的实现
│   ├── probe.py                 # probe() 函数
│   ├── executor.py              # execute_direct() 和 execute_decompose()
│   ├── recovery.py              # recover() 和 scan_tree()
│   ├── deps.py                  # validate_dependencies() 依赖校验层
│   ├── logger.py                # 全局 trace.jsonl / terminal.md / state.jsonl 写入
│   └── permissions.py           # permissions.json 加载与权限校验
└── tests/
    ├── test_primitives.py       # 原语的单元测试（权限校验、截断、边界情况）
    ├── test_deps.py             # 依赖校验层测试（缺失依赖、循环依赖）
    ├── test_recovery.py         # Recovery 测试（各种节点状态组合）
    ├── test_executor.py         # execute_direct / execute_decompose 测试
    └── test_agent.py            # meta_agent 端到端集成测试（mock llm_call）
```

### 四个原语

在 `primitives.py` 里实现，作为函数注入 script.py 的 exec 上下文：

```python
def make_primitives(node_dir: str, permissions: dict, logger) -> dict:
    """
    返回四个原语的字典，注入 script.py 的 exec 上下文。
    script.py 直接调用 read / write / bash / llm_call，不需要 import。
    """

    def read(path: str) -> str:
        # 权限校验：跨节点只读，路径必须在白名单内
        # 读取并返回文件内容

    def write(path: str, content: str) -> None:
        # 权限校验：默认只能写当前节点目录
        # 写入文件，目录不存在时自动创建

    def bash(command: str) -> str:
        # 执行 shell 命令，捕获 stdout + stderr
        # 输出超过 maxOutputLength 时截断并标记 truncated

    def llm_call(context: str | list[str], prompt: str) -> str:
        # 调用 LLM API（使用环境变量里的 API key）
        # context 是字符串或字符串列表，列表时自动拼接
        # 超出 token 预算时优先截断低优先级 context，不静默丢弃
        # 调用前后写 trace.jsonl（kind: llm_call，记录 token 数）

    return {"read": read, "write": write, "bash": bash, "llm_call": llm_call}
```

### meta-agent 核心递归函数

在 `agent.py` 里实现：

```python
def meta_agent(goal_dir: str, depth: int = 0) -> None:
    """
    输入：一个包含 goal.md 的目录
    输出：在该目录写入 results.md（completed 或 escalated）
    副作用：写 context.md、script.py、results.md、meta.json、全局记录
    """
```

执行顺序严格按照设计文档：
1. 读取 goal.md 和 meta.json
2. 加载 permissions.json（不存在时使用默认值）
3. probe()：理解任务形状，写 context.md
4. llm_call 决策：direct or decompose
5a. direct：execute_direct()
5b. decompose：validate_dependencies() → execute_decompose()
6. 写 results.md

### probe 函数

```python
def probe(goal_dir: str, goal: str, permissions: dict, logger) -> str:
    """
    以最小代价理解任务形状。
    1. bash 获取目录结构和文件大小（不读文件内容）
    2. 读取 memory.jsonl 最近 5 条作为历史参考
    3. llm_call 决定需要读哪些文件（返回 JSON: {files_by_priority: []}）
    4. 按优先级拉取文件内容，预算耗尽则停止，标记 context_truncated
    5. 写入 context.md
    返回：context 字符串
    """
```

### 依赖校验层

```python
def validate_dependencies(subtasks: list[dict]) -> list[dict]:
    """
    确定性校验，两关：
    第一关：depends_on 里的每个依赖必须存在于当前子任务列表
    第二关：拓扑排序检测循环依赖
    校验失败：抛出 ValidationError，携带详细原因
    调用方捕获后把错误信息注回 llm_call，重新产出依赖关系，不 Escalate
    最多重试 3 次，超限则 Escalate
    """
```

### 串行执行

`execute_decompose()` 里按拓扑序串行执行子节点：

```python
def execute_decompose(goal_dir, goal, subtasks, depth, permissions, logger):
    # 1. 创建子节点目录，写 goal.md 和 meta.json
    # 2. validate_dependencies()
    # 3. 拓扑排序，得到执行层级
    # 4. 按拓扑序串行执行：逐层逐节点调用 meta_agent()
    # 5. 每层执行完后检查子节点 results.md 的 status
    #    发现 escalated → 写当前节点 results.md 为 escalated，停止
    # 6. 全部完成 → llm_call 聚合所有子节点 results.md → 写当前节点 results.md
```

### Recovery

```python
def recover(goal_dir: str) -> None:
    """
    基于文件系统状态恢复执行，不需要额外状态管理。
    scan_tree() 扫描所有节点，topological_order() 排序。
    对每个节点：
      - results.md 存在且 decomposition_id 一致且 status != escalated → 跳过
      - results.md 存在但 decomposition_id 不一致 → 删除，重新执行
      - results.md 存在且 status == escalated 且 retry_count >= MAX_RETRY → 跳过
      - 其余 → meta_agent(node, depth)
    """
```

### 全局记录

`logger.py` 负责写三个全局文件，所有写入追加，不清空：

```python
class Logger:
    def log_trace(self, kind: str, node: str, **kwargs) -> int:
        # 追加写 .agent/trace.jsonl
        # 返回全局递增 seq

    def log_terminal(self, seq: int, node: str, symbol: str, message: str) -> None:
        # 追加写 .agent/terminal.md
        # symbol: 📍 正常，⚠️ 失败

    def log_state(self, event: str, **kwargs) -> None:
        # 追加写 .agent/state.jsonl
```

### results.md 格式

统一 JSON 格式，两种形态：

```python
# 正常完成
{"status": "completed", "result": "..."}

# Escalate
{"status": "escalated", "reason": "..."}
```

父节点聚合前先做确定性检查，发现 escalated 立即停止聚合，写入自身的 escalated results.md。

### meta.json 初始化

```python
DEFAULT_META = {
    "goal_id": str(uuid4()),
    "parent_goal_id": None,
    "depth": 0,
    "decomposition_id": "",
    "status": "not_started",
    "retry_count": 0,
    "context_truncated": False,
    "created_at": "",
    "completed_at": None
}
```

---

## 约束

- 所有 LLM 返回 JSON 的地方，加 try/except 处理解析失败，解析失败时把原始输出和错误信息注回 llm_call 重新生成，最多重试 2 次
- llm_call 使用的模型和 API key 从环境变量读取：`LLM_MODEL`、`LLM_API_KEY`、`LLM_BASE_URL`
- MAX_DEPTH 默认 4，MAX_RETRY 默认 3，从环境变量可覆盖
- 所有文件写入前检查路径权限，违规时抛出 PermissionError 并写入 escalated results.md
- script.py 用 exec() 在同进程执行，四个原语通过 make_primitives() 注入执行上下文
- exec 执行时捕获所有异常，写入 escalated results.md，更新 meta.json status 为 failed

---

## 入口

```python
# main.py 使用示例
# python main.py --goal-dir ./my_task
# python main.py --goal-dir ./my_task --recover   # 续接失败的任务
```

`--goal-dir` 目录下必须有 goal.md，其余文件由 meta-agent 自动生成。`--recover` 时调用 recover() 而不是 meta_agent()。

---

## 不要做的事

- 不要在 primitives.py 以外的地方直接调用 LLM API
- 不要在 LLMCall 内部做权限决策
- 不要让 results.md 被覆盖写入，覆盖前必须先删除旧文件
- 不要在 script.py 执行过程中截断 llm_call
- 不要硬编码 API key

