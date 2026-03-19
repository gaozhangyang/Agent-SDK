# Recursive Meta-Agent

一个基于目录树的递归 agent runtime。当前版本的目标不是“无限聪明”，而是把以下几件事做实：

- `AGENT.md` 成为真实可消费的配置源
- 节点执行遵循统一状态机
- 每个节点都产出结构化 `artifact.json`
- 根节点 `results.md` 来自聚合产物，而不是临时 stdout
- README、代码、测试三者保持一致

---

## 当前状态

已实现并验证：

- `AGENT.md` 解析、归一化、按角色注入 `planner/coder/observer`
- 统一状态机：`probe -> decision -> act -> finalize`
- direct 模式的有限自修复重试
- decompose 模式的子节点递归与聚合
- 每个节点写 `artifact.json`
- 根节点基于 artifact 生成 `results.md`
- 子节点把结构化摘要追加到父节点 `context.md`
- 测试通过：`pytest recursive-meta-agent/tests -q`

当前未实现：

- 真正的 OS 级沙箱和网络/删除强隔离
- 并行调度
- 自动续读并替换父节点截断块
- 长上下文的索引化存储

所以它现在更准确的定位是：

> 一个可递归执行、可聚合结果、可由 `AGENT.md` 约束行为的 agent runtime skeleton。

不是“已经无条件稳定完成任意任务”的最终系统。

---

## 新蓝图

### 1. 配置层

配置分两类：

- `.agent/AGENT.md`
  - 行为配置
  - 上下文预算
  - 分解深度
  - learned patterns
- `permissions.json`
  - 运行时硬边界
  - 当前实现主要承载 `max_depth` 和 `bash` 开关

`AGENT.md` 是行为主配置源，运行时会解析后归一化，例如：

```md
# [all]
maxOutputLength: 102400
contextBudget: {'total': 200000, 'reservedOutput': 4000}
contextMaxChars: 800000

# [decompose]
max_depth: 4

# [learned_patterns]
prefer explore-first when context is incomplete
```

### 2. 节点状态机

每个节点执行统一流程：

1. `probe`
   - 读取当前 `goal.md`
   - 读取目录结构
   - 注入 `AGENT.md` 对当前角色有用的片段
   - 子节点额外读取父节点 `context.md`
   - 解引用父节点中的 `<<read>> ... <<read/>>`
2. `decision`
   - planner 判断 `direct` 或 `decompose`
3. `act`
   - `direct`: 生成 `script.py`，执行，observer 提取结构化结果
   - `decompose`: 创建子节点，递归执行
4. `finalize`
   - 统一写 `artifact.json`
   - 根节点把 artifact 渲染为 `results.md`
   - 非根节点把摘要追加到父节点 `context.md`

### 3. 节点产物

每个节点都会写：

- `context.md`
- `script.py`（仅 direct 节点）
- `artifact.json`

`artifact.json` 是当前版本最重要的稳定接口。典型结构：

```json
{
  "node": "1_fetch_config",
  "goal": "读取配置并提取关键参数",
  "mode": "direct",
  "status": "success",
  "summary": "Read config.json and extracted api_base/api_key names.",
  "observation": "[DONE] ...",
  "direct_info": "api_base=https://...\\nmodel=gpt-4.1",
  "indirect_files": ["/abs/path/to/output.json"],
  "open_questions": [],
  "recommended_next_action": "finish",
  "retries": 1,
  "attempts": [...]
}
```

对于 `decompose` 节点，还会额外包含：

- `children`
- `child_summaries`

### 4. direct 模式

direct 模式不再是一轮失败即结束，而是有限修复循环：

1. coder 生成 `script.py`
2. 子进程执行脚本
3. observer 输出严格 JSON
4. 如果 observer 未给出 `success`，将失败信息回灌给下一轮 coder
5. 最多重试 `min(MAX_RETRY, 3)` 次

这不是完整自治修复器，但足够避免最常见的“一次生成路径猜错就整体失败”。

### 5. decompose 模式

planner 返回：

```json
{
  "type": "decompose",
  "subtasks": [
    {
      "name": "explore_environment",
      "description": "## 任务\n...\n\n## 输出要求\n...\n\n## 输出用途\n...\n\n## 后续兄弟任务\n...",
      "depends_on": []
    }
  ]
}
```

运行时会：

- 清洗子任务名
- 重写 `depends_on`
- 校验依赖
- 分层串行执行
- 聚合子节点 artifact 为父节点 artifact

### 6. 结果传播

旧版问题是分解完成后根节点只能得到 `"Decompose completed"`。

当前版本改为：

- 子节点向父节点传播的是结构化摘要块
- 根节点结果来自自己的 `artifact.json`
- decompose 根节点会汇总 `child_summaries`

因此复杂任务的最终输出不再依赖某一轮 stdout 偶然是否完整。

---

## 目录结构

```text
workspace/
├── .agent/
│   └── AGENT.md
└── my_goal/
    ├── goal.md
    ├── context.md
    ├── artifact.json
    ├── results.md          # 仅根节点
    ├── permissions.json    # 可选，通常放在根节点
    ├── script.py           # direct 节点会生成
    ├── 1_subtask/
    │   ├── goal.md
    │   ├── context.md
    │   ├── artifact.json
    │   └── script.py
    └── 2_subtask/
```

---

## 关键模块

- `src/agent.py`
  - 主递归入口
  - 决策
  - finalize
- `src/agent_config.py`
  - `AGENT.md` 查找、解析、归一化、角色注入
- `src/probe.py`
  - context 构建
  - `<<read>>` 解引用
- `src/executor.py`
  - direct 执行
  - observer 解析
  - artifact 写入
  - decompose 聚合
- `src/primitives.py`
  - 内部 `llm_call`
  - system prompt + role hint + AGENT context 拼装

---

## Prompt 约定

当前 prompt 文件：

- `src/prompts/system_prompt.md`
- `src/prompts/decision.md`
- `src/prompts/code_generator.md`
- `src/prompts/observer.md`

其中：

- `system_prompt.md` 现在已经实际接入 runtime
- `observer.md` 使用严格 JSON schema
- `code_generator.md` 支持多轮 attempt 和 `previous_error`

---

## 使用方式

```bash
python main.py --goal-dir ./my_goal
```

前提：

- `goal.md` 存在
- 环境变量中提供 LLM 配置

最小环境变量：

```bash
export LLM_API_KEY=...
export LLM_BASE_URL=http://127.0.0.1:3888/v1/
export LLM_MODEL=MiniMax-M2.5
```

---

## 设计边界

### 已经解决的问题

- 文档与实现脱节
- `AGENT.md` 不生效
- 分解节点没有可聚合产物
- 根节点结果丢失
- direct 模式没有基本修复循环
- 测试集绑定旧接口，无法提供回归保护

### 还没有解决的问题

- 运行脚本仍然是通用 Python `exec`，不是强安全模型
- observer 质量仍依赖模型
- 长任务的 context 仍可能膨胀
- 复杂跨节点记忆仍然偏弱

这意味着如果你的目标是：

> “给定 AGENT.md，就稳定完成任意 agent 任务”

那当前代码是一个更可靠的底座，但还需要继续做三件大事：

1. 受控执行沙箱
2. artifact/index 驱动的长上下文管理
3. 更强的 planner/observer 自监督闭环

---

## 开发与测试

运行测试：

```bash
pytest recursive-meta-agent/tests -q
```

本次重构后，测试覆盖了：

- `AGENT.md` 解析
- probe 构建
- direct/decompose artifact 生成
- context 追加
- permissions 加载
- primitives 基础调用
- 依赖拓扑校验

---

## 一句话总结

当前版本的 recursive meta-agent 已经从“文档原型”收敛成“可运行、可测试、可聚合结果的递归 agent runtime”，并且 `README.md` 与实际代码行为保持一致。
