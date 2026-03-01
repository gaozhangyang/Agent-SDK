# Agent Runtime Core SDK — Python 调用模板

> 本模板用于从 SDK 派生出新的 Agent 应用。
> 加载此文档 + 提供新 Agent 的设计目标 → 即可构建使用 SDK 的 Python Agent 应用。

---

## 一、启动 SDK 服务

```bash
cd agent-runtime-core
npm run start:server
# 默认监听 http://0.0.0.0:3889
```

---

## 二、Python 调用方式

```python
import requests

# 调用 Agent 循环
response = requests.post("http://127.0.0.1:3889/run", json={
    "goal": "你的任务目标",
    "workDir": "/path/to/git/repo",
    "collectConfig": {...},
    "llm": {...}
})
result = response.json()
print(result["status"])  # completed | escalated | budget_exceeded
```

---

## 三、POST /run 接口

### 请求参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| **goal** | string | ✅ | 任务目标描述 |
| **workDir** | string | ✅ | 工作目录（须为 git 仓库） |
| **subgoals** | string[] | ❌ | 子目标列表 |
| **collectConfig** | object | ✅ | 上下文收集配置 |
| **llm** | object | ✅ | LLM 配置 |
| **thresholds** | object | ❌ | 阈值配置 |

### collectConfig 结构

```python
"collectConfig": {
    "sources": [
        {"type": "file", "query": "AGENTS.md"},
        {"type": "file", "query": "src/main.py"},
        {"type": "bash", "query": "rg -n 'TODO' src/"},
        {"type": "bash", "query": "git log --oneline -5"}
    ],
    "filters": ["关键词"],      # 可选，关键词过滤
    "maxTokens": 4000          # 可选，上下文预算
}
```

**source.type 可选值：**
| 类型 | query 说明 |
|------|------------|
| `file` | 文件路径（相对于 workDir） |
| `bash` | shell 命令（用于 grep/ripgrep 搜索代码） |
| `trace_tag` | Trace 标签（用于检索历史记录） |

### llm 结构

```python
"llm": {
    "baseUrl": "http://your-llm/v1",
    "model": "your-model-name",
    "apiKey": "your-api-key"
}
```

### thresholds 结构（可选）

```python
"thresholds": {
    "confidenceLow": 0.3,        # 置信度低于此值 → Escalate
    "confidenceMid": 0.6,        # 置信度低于此值 → 补采集
    "uncertaintyHigh": 0.7,      # 不确定性高于此值 → Escalate/多候选
    "maxIterations": 50,        # 最大迭代次数
    "maxNoProgress": 3,         # 连续无增益上限
    "maxCollectRetry": 3        # 最大补采集次数
}
```

---

## 四、响应格式

### 成功响应

```python
{
    "status": "completed",  # 任务完成
    "reason": None,
    "state": {
        "goal": "任务目标",
        "subgoals": [],
        "currentSubgoal": None,
        "mode": "review",
        "permissions": 2,
        "iterationCount": 3,
        "noProgressCount": 0,
        "version": 5,
        "custom": {}
    },
    "traceJson": "[...]",   # Trace 日志 JSON 字符串
    "traceLength": 12       # Trace 条目数量
}
```

### Escalated 响应

```python
{
    "status": "escalated",
    "reason": "置信度不足: coverage=0.20, reliability=0.50",
    "state": {...},
    "traceJson": "[...]",
    "traceLength": 8
}
```

### Budget Exceeded 响应

```python
{
    "status": "budget_exceeded",
    "reason": None,
    "state": {...},
    "traceJson": "[...]",
    "traceLength": 50
}
```

---

## 五、快速模板：创建一个新 Agent

```python
import requests

def run_agent(goal: str, work_dir: str, sources: list, llm_config: dict):
    """运行 Agent"""
    response = requests.post("http://127.0.0.1:3889/run", json={
        "goal": goal,
        "workDir": work_dir,
        "collectConfig": {
            "sources": sources,
            "maxTokens": 4000
        },
        "llm": llm_config
    })
    return response.json()

# 使用示例
if __name__ == "__main__":
    result = run_agent(
        goal="分析 utils.ts 中的 bug 并生成修复建议",
        work_dir="/tmp/my-project",
        sources=[
            {"type": "file", "query": "AGENTS.md"},
            {"type": "file", "query": "utils.ts"},
            {"type": "bash", "query": "rg -n 'BUG\\|FIXME\\|TODO' ."}
        ],
        llm_config={
            "baseUrl": "http://35.220.164.252:3888/v1",
            "model": "MiniMax-M2.5",
            "apiKey": "your-key"
        }
    )
    print(f"状态: {result['status']}")
    print(f"迭代: {result['state']['iterationCount']}")
    print(f"Trace: {result['traceLength']} 条")
```

---

## 六、健康检查

```python
import requests

response = requests.get("http://127.0.0.1:3889/health")
# 响应: {"status": "ok", "service": "agent-runtime-core"}
```

---

## 七、一句话总结

> 加载本模板 → 提供 goal + workDir + collectConfig.sources + llm 配置 → POST /run → 获取结果。

（只需知道 HTTP 接口的输入输出，无需关心 SDK 内部实现。）
