# Recursive Survey Agent

> 本文件定义了 Recursive Survey Agent 的静态上下文，是 recursive-meta-agent 启动时自动加载的配置文件。
> **核心设计原则**：Python 代码只做「容器 + 接口」，具体 workflow 主要通过 AGENT 配置和 skills 文档来驱动。

## 目标

自动化学术文献检索与知识管理：每日从 arXiv 获取最新论文，根据用户预设的研究兴趣主题筛选高潜力论文，将论文总结写入对应的知识板块。

## 核心能力边界

- **Fetcher**: 从 arXiv API 抓取指定分类的最新论文
- **Screener**: 基于用户兴趣配置和知识库关键词筛选论文
- **Analyst**: 阅读并总结论文核心贡献，写入知识板块

## 项目结构

```
recursive_survey_agent/
├── .agent/                    # Agent 运行时状态与配置
│   └── AGENT.md              # 静态上下文（定义 Survey Workflow 及运行时配置）
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
├── goals/                    # 任务目标目录（每次运行自动创建）
│   └── survey_YYYYMMDD_HHMMSS/
│       ├── goal.md           # 任务描述
│       ├── context.md        # 收集的上下文
│       ├── script.py         # 生成的执行脚本
│       ├── results.md        # 任务结果
│       ├── meta.json         # 节点元数据
│       ├── permissions.json  # 权限配置
│       └── {subgoal}/        # 子任务目录
├── data/                     # 运行时数据
│   ├── pdfs/                 # PDF 文件存储
│   ├── raw_papers_*.json     # 原始论文数据
│   ├── selected_papers_*.json # 筛选后论文
│   └── run_log.jsonl        # 运行日志
├── knowledge_base/           # 知识板块目录
│   └── {topic}/
│       ├── meta.json         # 主题元信息
│       └── paper_*.md        # 论文总结
├── templates/                # 模板目录
│   └── paper_summary.md     # 论文总结模板
├── run.py                    # 入口脚本
└── README.md                 # 项目说明
```

## 四个原语

recursive-meta-agent 使用四个原语执行任务：

| 原语 | 说明 | 用法示例 |
|------|------|----------|
| `read(path)` | 读取文件内容 | `content = read("skills/arxiv_api/SKILL.md")` |
| `write(path, content)` | 写入文件 | `write("data/output.txt", "Hello")` |
| `bash(command)` | 执行 shell 命令 | `output = bash("python script.py")` |
| `llm_call(context, prompt)` | 调用 LLM | `result = llm_call(context, "分析这段文字")` |

**重要**：
- 所有原语直接可用，不需要 import
- `read` 可以跨目录读取（在 permissions.json 允许范围内）
- `write` 默认只能写当前节点目录
- `llm_call` 是唯一的随机性入口

## Survey Workflow

> **重要说明**：Python 代码只负责提供必要的工具/脚本和目录结构，真正的工作流程由 recursive-meta-agent 自己推理。

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

```python
# 使用 bash 原语调用
output = bash("python skills/arxiv_api/fetch_arxiv.py -c cs.CV,cs.LG -m 10 -o data/raw_papers_2026-03-03.json")
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

```python
output = bash("""python skills/screening/screen_papers.py \
  data/raw_papers_2026-03-03.json \
  data/selected_papers_2026-03-03.json \
  --topics knowledge_base \
  --blacklist data/blacklist.json""")
```

### Analyst 阶段

**目标**：对筛选后的每篇论文进行分析，生成总结并写入知识库。

**对每一篇论文，按如下顺序操作**：

1. **下载 PDF**（如果本地没有）：
   - PDF 存储路径：`data/pdfs/{arxiv_id}.pdf`
2. **提取 PDF 文本**：
   - 使用 `skills/pdf_extract/extract_text.py`
   - 输出到 `data/pdfs/{arxiv_id}.txt`
3. **生成论文总结**：
   - 使用 llm_call 配合 skills/writing/
   - 写入 `knowledge_base/{topic}/paper_{arxiv_id}.md`
   - 更新 `knowledge_base/{topic}/meta.json`

### 目录与文件约定

| 类型 | 路径 | 说明 |
|------|------|------|
| 原始论文 | `data/raw_papers_{YYYY-MM-DD}.json` | Fetcher 输出 |
| 筛选后论文 | `data/selected_papers_{YYYY-MM-DD}.json` | Screener 输出 |
| PDF 文件 | `data/pdfs/{arxiv_id}.pdf` | 论文 PDF |
| PDF 文本 | `data/pdfs/{arxiv_id}.txt` | 可选提取文本 |
| 论文总结 | `knowledge_base/{topic}/paper_{arxiv_id}.md` | Analyst 输出 |
| 知识库元信息 | `knowledge_base/{topic}/meta.json` | 板块元信息 |

## 运行时配置

以下配置在 AGENT.md 中定义，**可通过环境变量覆盖**：

```json
{
  "llm": {
    "baseUrl": "http://35.220.164.252:3888/v1",
    "model": "MiniMax-M2.5",
    "apiKey": "${LLM_API_KEY}"
  },
  "fetch_max_papers": 10,
  "screening_threshold": 0.6,
  "pdf_download_dir": "data/pdfs",
  "max_depth": 4,
  "max_retry": 3,
  "maxOutputLength": 102400,
  "context_budget_total": 200000,
  "context_budget_reserved": 4000,
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
  ]
}
```

环境变量覆盖：
- `LLM_API_KEY`: API 密钥
- `LLM_MODEL`: 模型名称（默认: MiniMax-M2.5）
- `LLM_BASE_URL`: API 地址

### 阈值配置说明

| 阈值项 | 说明 | 默认值 |
|--------|------|--------|
| max_depth | 最大递归深度 | 4 |
| max_retry | 最大重试次数 | 3 |
| maxOutputLength | 输出最大长度 | 102400 |
| context_budget_total | 上下文总 token 预算 | 200000 |
| context_budget_reserved | 保留给输出的 token 数 | 4000 |

## 设计原则

1. **Workflow 驱动**：具体的工作流程通过 AGENT.md + skills 文档定义
2. **Skills 作为可组合能力单元**：每个 Skill 独立定义职责
3. **Python 薄封装**：Python 代码只提供运行时容器和少量胶水逻辑
4. **修改优先序**：业务逻辑修改应优先改 AGENT.md 和 skills
5. **配置集中管理**：所有运行时配置集中在 AGENT.md 中
