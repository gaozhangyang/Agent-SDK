# Survey Agent (Python)

> 本文件定义了 Survey Agent 的静态上下文，是 Agent 启动时自动加载的 AGENT.md。
> **核心设计原则**：Python 代码只做「容器 + 接口」，具体 workflow 主要通过 AGENT 配置和 skills 文档来驱动。

## 目标

自动化学术文献检索与知识管理：每日从 arXiv 获取最新论文，根据用户预设的研究兴趣主题筛选高潜力论文，将论文总结写入对应的知识板块。

## 核心能力边界

- **Fetcher**: 从 arXiv API 抓取指定分类的最新论文
- **Screener**: 基于用户兴趣配置和知识库关键词筛选论文
- **Analyst**: 阅读并总结论文核心贡献，写入知识板块

## 项目结构

```
survey_agent_python/
├── .agent/                    # 运行时状态与配置
│   ├── AGENT.md              # 静态上下文（定义 Survey Workflow 及运行时配置）
│   ├── state.json            # State 快照（首次运行后生成）
│   ├── trace.jsonl           # 推理轨迹（首次运行后生成）
│   └── terminal.md           # Terminal Log（首次运行后生成）
├── skills/                   # 技能目录（每个技能一个文件夹）
│   ├── arxiv_api/           # arXiv API 抓取技能
│   │   ├── SKILL.md         # 技能说明文档
│   │   └── fetch_arxiv.py   # 论文抓取脚本
│   ├── screening/           # 论文筛选技能
│   │   ├── SKILL.md         # 技能说明文档
│   │   └── screen_papers.py # 论文筛选脚本
│   ├── writing/             # 论文总结写作技能
│   │   └── SKILL.md         # 技能说明文档
│   └── pdf_extract/         # PDF 解析技能
│       ├── SKILL.md         # 技能说明文档
│       └── extract_text.py  # PDF 文本提取脚本
├── run.py                    # 入口脚本（执行 python run.py）
└── README.md                 # 项目说明
```

> **注意**：以下目录在运行时会自动创建或使用（无需初始化包含）：
>
> - `data/` - 运行时数据（原始论文、筛选结果、PDF 等）
> - `knowledge_base/` - 知识板块目录
> - `templates/` - 模板目录

## Collect 检索配置

Survey Agent 使用 `Collect` 协议获取上下文。检索范围明确包括：


| 来源类型      | 说明                 | 典型用途          |
| --------- | ------------------ | ------------- |
| file      | 读取指定文件             | 模板、知识库文档      |
| trace_tag | 按标签过滤 Trace 历史     | 获取特定类型的推理记录   |
| skills    | 从 skills/ 目录检索技能文档 | 获取工具使用说明、最佳实践 |


**注意：** Memory（长期记忆）在子目标完成时自动记录，通过 `memory.search(query)` 方法检索，不通过 Collect 协议。

### Collect 配置示例

```json
{
  "sources": [
    { "type": "file", "query": "templates/paper_summary.md", "weight": 1.0 },
    { "type": "trace_tag", "query": "fetcher", "weight": 0.8 },
    { "type": "skills", "query": "arxiv_api", "weight": 1.0 }
  ]
}
```

### Skills 目录结构

Survey Agent 使用基于文件夹的 Skill 结构，每个 Skill 是一个独立的文件夹，内含 SKILL.md 及该技能所需的脚本与资源：

```
skills/
├── arxiv_api/           # arXiv API 抓取技能
│   ├── SKILL.md         # 技能说明文档
│   └── fetch_arxiv.py   # 论文抓取脚本
├── screening/           # 论文筛选技能
│   ├── SKILL.md         # 技能说明文档
│   └── screen_papers.py # 论文筛选脚本
├── writing/             # 论文总结写作技能
│   └── SKILL.md         # 技能说明文档
└── pdf_extract/         # PDF 解析技能
    ├── SKILL.md         # 技能说明文档
    └── extract_text.py # PDF 文本提取脚本
```

**注意：** 在 Collect 配置中使用 `type: "skills"` 时，query 会解析到对应的 `skills/<name>/SKILL.md`。例如：

- `query: "writing"` -> `skills/writing/SKILL.md`
- `query: "pdf_extract"` -> `skills/pdf_extract/SKILL.md`

**pdf_extract 技能说明：**

- 用于将 PDF 路径转换为纯文本，供分析/总结使用
- 支持指定页码范围、最大页数、布局保留等选项
- 输出可直接在 Collect 配置中作为 file 来源使用

## 权限级别

- Level 1: 受控写（write/edit 限 workspace）
- Level 2: 受控执行（bash 常规命令）

## 运行时约束

1. 每次运行绑定 `survey_agent_python/` 目录
2. Trace、Terminal Log、Memory 追加写到 `.agent/` 目录
3. Session 恢复：检测 `.agent/state.json` 是否存在，存在则恢复
4. AGENT.md 作为静态上下文，在每次 LLMCall 时自动注入

## 输出格式要求

当需要执行工具时，**必须使用以下XML格式**输出工具调用：

```
<invoke name="Bash">
  <parameter name="command">实际命令</parameter>
</invoke>

<invoke name="Read">
  <parameter name="path">文件路径</parameter>
</invoke>

<invoke name="Write">
  <parameter name="path">文件路径</parameter>
  <parameter name="content">文件内容</parameter>
</invoke>

<invoke name="Edit">
  <parameter name="path">文件路径</parameter>
  <parameter name="old">需要替换的旧内容</parameter>
  <parameter name="next">替换后的新内容</parameter>
</invoke>
```

**重要**：

- 必须使用 `<invoke name="...">` 格式包裹工具调用
- 每个参数必须使用 `<parameter name="参数名">参数值</parameter>` 格式
- 不要输出纯文本格式的命令（如 `bash cd /path && ls`），否则命令将不会被执行

## 运行时配置

以下配置在 AGENT.md 中定义，**apiKey 可通过环境变量覆盖**（如 `LLM_API_KEY`）：

### 运行参数配置

```json
{
  "llm": {
    "baseUrl": "http://35.220.164.252:3888/v1",
    "model": "MiniMax-M2.5",
    "apiKey": "${LLM_API_KEY}"
  },
  "sdk_url": "http://127.0.0.1:3890",
  "fetch_max_papers": 10,
  "screening_threshold": 0.6,
  "pdf_download_dir": "data/pdfs",
  "debug": false,
  "topics": [
    {
      "name": "Computer_Vision",
      "keywords": ["video generation", "diffusion", "video synthesis", "long video", "image generation", "image editing"],
      "arxiv_categories": ["cs.CV"],
      "min_relevance_score": 0.6
    },
    {
      "name": "NLP_and_LLM",
      "keywords": ["language model", "LLM", "transformer", "attention", "large language model", "text generation"],
      "arxiv_categories": ["cs.CL", "cs.LG"],
      "min_relevance_score": 0.6
    },
    {
      "name": "Reinforcement_Learning",
      "keywords": ["reinforcement learning", "RL", "policy", "reward", "agent"],
      "arxiv_categories": ["cs.LG", "cs.AI"],
      "min_relevance_score": 0.5
    }
  ],
  "maxOutputLength": 64000,
  "thresholds": {
    "confidenceLow": 0.3,
    "confidenceMid": 0.6,
    "uncertaintyHigh": 0.85,
    "maxNoProgress": 3,
    "maxIterations": 20
  },
  "strategies": {
    "level": "L1",
    "permissions": 3,
    "mode_fsm": "enabled",
    "permission_fsm": "enabled",
    "harness": "standard",
    "error_classifier": "enabled",
    "judge": {
      "outcome": "required",
      "risk": "enabled",
      "milestone": "enabled",
      "capability": "enabled",
      "selection": "disabled"
    }
  }
}
```

### 阈值配置说明


| 阈值项             | 说明      | 生效环节                            | 触发场景                                                             | 默认值 |
| --------------- | ------- | ------------------------------- | ---------------------------------------------------------------- | --- |
| confidenceLow   | 置信度低阈值  | Collect 阶段                      | 收集的上下文覆盖度(coverage)或可靠性(reliability)低于此值时，触发 Escalate            | 0.3 |
| confidenceMid   | 置信度中阈值  | Collect 阶段                      | 用于内部判断，当前仅作为参考阈值                                                 | 0.6 |
| uncertaintyHigh | 不确定性高阈值 | Plan/Reason 阶段和 Review/Judge 阶段 | LLM 推理的 uncertainty.score 高于此值，或 Judge 判断不确定性过高时，触发 Escalate     | 0.7 |
| maxNoProgress   | 最大无进展次数 | Review 阶段                       | 连续多次迭代未达成目标（achieved=false 或 uncertainty 过高）时累加，达到此值后触发 Escalate | 3   |
| maxIterations   | 最大迭代次数  | 循环入口                            | 整个任务的总迭代次数达到此值后，任务以 budget_exceeded 状态终止                         | 30  |
| truncateWindowSize | 截断窗口大小 | TerminalLog 格式化阶段 | terminal.md 中输入输出的截断窗口大小，控制展示长度 | 200 |


> **各阈值的详细作用场景**：
>
> - **confidenceLow**：在 Collect 阶段结束后检查。如果收集到的上下文覆盖度或可靠性低于此值，说明 Agent 没有足够的信息来完成任务，此时触发 Escalate 将问题上报。
> - **confidenceMid**：作为参考阈值，目前主要用于内部判断，未来可能用于更细粒度的策略调整。
> - **uncertaintyHigh**：在两个阶段检查：(1) Plan 阶段的 LLM Reason 调用返回后，检查 uncertainty.score；(2) Review 阶段的 Judge(outcome) 调用返回后，检查 outcome uncertainty。如果超过此阈值，触发 Escalate。
> - **maxNoProgress**：在 Review 阶段检查。当 Judge 判断目标未达成（achieved=false）或不确定性过高时，noProgressCount 累加。连续多次无进展后触发 Escalate，避免 Agent 在死循环中消耗资源。
> - **maxIterations**：在每次循环开始时检查。当 iterationCount 达到此值时，任务以 budget_exceeded 状态终止，确保任务不会无限运行下去。

> **注意**：thresholds 配置可从 AGENT.md 中读取，也可通过 HTTP 请求覆盖。请求中的阈值优先级高于 AGENT.md 中的配置。

### 策略层配置说明


| 策略项              | 说明                                             | 可选值                            |
| ---------------- | ---------------------------------------------- | ------------------------------ |
| level            | 基础策略包，决定默认启用范围                                 | L0, L1, L2, L3                 |
| permissions      | 初始权限级别（0-4），定义 Agent 可执行的操作范围                  | 0-4                            |
| mode_fsm         | Mode 状态机（Plan/Execute/Review/Recovery/Paused）  | enabled, disabled              |
| permission_fsm   | 权限状态机（Level 0-4）                               | enabled, disabled              |
| harness          | 快照策略                                           | standard, aggressive, disabled |
| error_classifier | 错误分类（retryable / logic / environment / budget） | enabled, disabled              |
| judge.outcome    | Loop 终止收敛（不可关闭，可降级为 rule_based）                | required, rule_based, disabled |
| judge.risk       | 高权限操作门卫                                        | enabled, disabled              |
| judge.milestone  | git commit 时机判断                                | enabled, disabled              |
| judge.capability | 启动时能力边界声明                                      | enabled, disabled              |
| judge.selection  | 多候选仲裁                                          | enabled, disabled              |


**权限级别说明：**


| 级别  | 名称    | 允许的操作             |
| --- | ----- | ----------------- |
| 0   | 只读    | read              |
| 1   | 受控写   | write/edit（限工作区）  |
| 2   | 受控执行  | bash（常规命令，无网络/删除） |
| 3   | 高风险执行 | bash（网络、删除、系统级变更） |
| 4   | 自主模式  | 预授权范围内自动执行        |


> Survey Agent 需要从 arXiv API 获取论文，因此需要权限级别 3。

---

## Survey Workflow

> **重要说明**：Python 代码只负责提供必要的工具/脚本和目录结构，真正的「先做什么，再做什么」应该由 Agent 在 Plan/Execute 阶段，参考 AGENT.md + skills 自己推理出来。

### Daily Survey Workflow 总览

该 Agent 每次运行的高层目标是：**根据用户主题配置，从 arXiv 获取最新论文，筛选高潜力论文并写入知识库**。

完整流程分为三个阶段：

1. **Fetcher**：从 arXiv 抓取论文
2. **Screener**：基于配置和知识库筛选论文
3. **Analyst**：分析论文并写入知识库

### Fetcher 阶段

**目标**：从 arXiv API 抓取指定分类的最新论文。

**配置来源**：

- 优先参考 `skills/arxiv_api/SKILL.md`
- 从本 AGENT.md 的「运行时配置」中读取 `fetch_max_papers` 和 topics 的 `arxiv_categories`

**调用参数**：

- `categories`: arXiv 分类列表（如 `cs.CV`, `cs.LG`）
- `max_results`: 最大抓取数量（默认 10）
- `start_date`: 开始日期 (YYYYMMDD)
- `end_date`: 结束日期 (YYYYMMDD)

**输出约定**：

- 将原始结果写入 `data/raw_papers_{YYYY-MM-DD}.json`
- 输出格式参考 `skills/arxiv_api/SKILL.md`

**调用方式**：

```bash
python skills/arxiv_api/fetch_arxiv.py -c cs.CV,cs.LG -m 10 -o data/raw_papers_2026-03-03.json
```

### Screener 阶段

**目标**：基于用户兴趣配置和知识库关键词筛选论文。

**配置来源**：

- 优先参考 `skills/screening/SKILL.md`
- 从本 AGENT.md 的「运行时配置」中读取 topics 和 screening_threshold
- 读取 `knowledge_base/{topic}/meta.json`
- 读取 `data/blacklist.json`

**输入**：

- `raw_papers_{YYYY-MM-DD}.json`（Fetcher 阶段的输出）

**输出约定**：

- 写入 `data/selected_papers_{YYYY-MM-DD}.json`
- 输出结构沿用 `skills/screening/SKILL.md` 的格式

**调用方式**：

```bash
python skills/screening/screen_papers.py data/raw_papers_2026-03-03.json data/selected_papers_2026-03-03.json \
  --topics knowledge_base \
  --blacklist data/blacklist.json
```

**智能筛选**：可以按需调用 meta-agent-core SDK 做更智能的筛选，参考 `skills/screening/SKILL.md` 中的 SDK 示例。

### Analyst 阶段

**目标**：对筛选后的每篇论文进行分析，生成总结并写入知识库。

**对每一篇论文，按如下顺序操作**：

1. **下载 PDF**（如果本地没有）：
  - PDF 存储路径：`data/pdfs/{arxiv_id}.pdf`
  - 可参考 `scripts/download_pdf.py`
2. **提取 PDF 文本**：
  - 使用 `skills/pdf_extract/extract_text.py`
  - 输出到 `data/pdfs/{arxiv_id}.txt`
3. **生成论文总结**：
  - 使用 meta-agent-core SDK 和 `skills/writing/`
  - 写入 `knowledge_base/{topic}/paper_{arxiv_id}.md`
  - 更新 `knowledge_base/{topic}/meta.json`

**CollectConfig 的典型组成**：

- 模板文件：`templates/paper_summary.md`
- 对应 topic 的 `knowledge_base/{topic}/meta.json`
- PDF 文件或提取出的文本文件
- `skills/writing/SKILL.md`

**SDK 调用示例**：

```python
result = sdk.run(
    goal=f"深度分析论文 {arxiv_id}，PDF已下载到 {pdf_path}，"
         f"生成总结，写入 knowledge_base/{target_topic}/paper_{arxiv_id}.md，"
         f"更新 meta.json",
    workDir=str(project_dir),
    collectConfig={
        "sources": [
            {"type": "file", "query": "templates/paper_summary.md"},
            {"type": "file", "query": f"knowledge_base/{target_topic}/meta.json"},
            {"type": "file", "query": str(pdf_path)},
            {"type": "skills", "query": "writing"},
        ],
        "maxTokens": 6000
    }
)
```

### 目录与文件约定


| 类型     | 路径                                           | 说明          |
| ------ | -------------------------------------------- | ----------- |
| 原始论文   | `data/raw_papers_{YYYY-MM-DD}.json`          | Fetcher 输出  |
| 筛选后论文  | `data/selected_papers_{YYYY-MM-DD}.json`     | Screener 输出 |
| PDF 文件 | `data/pdfs/{arxiv_id}.pdf`                   | 论文 PDF      |
| PDF 文本 | `data/pdfs/{arxiv_id}.txt`                   | 可选提取文本      |
| 论文总结   | `knowledge_base/{topic}/paper_{arxiv_id}.md` | Analyst 输出  |
| 知识库元信息 | `knowledge_base/{topic}/meta.json`           | 板块元信息       |


### 设计原则

1. **Workflow 驱动**：具体的工作流程通过 AGENT.md + skills 文档定义，而不是硬编码在 Python 代码中
2. **Skills 作为可组合能力单元**：每个 Skill 独立定义职责，通过 CollectConfig 组合使用
3. **Python 薄封装**：Python 代码只提供运行时容器、API 接口和少量胶水逻辑
4. **修改优先序**：业务逻辑修改应优先改 AGENT.md 和 skills，而不是改 Python 源码

