# Recursive Survey Agent

> 基于 recursive-meta-agent 实现的自动化学术文献检索与知识管理 Agent。

## 核心设计

**Python 代码只做「容器 + 接口」，具体 workflow 主要通过 AGENT 配置和 skills 文档来驱动。**

- `.agent/AGENT.md` 定义了 Survey Workflow 的完整规范（Fetcher → Screener → Analyst）及运行时配置
- `skills/` 目录下各技能定义了具体实现细节
- `run.py` 是唯一入口脚本，执行 `python run.py` 即可运行
- 后端使用 `recursive-meta-agent` 执行任务

## 与 survey_agent_python 的区别


| 特性   | survey_agent_python        | recursive_survey_agent        |
| ---- | -------------------------- | ----------------------------- |
| 后端   | meta-agent-core (HTTP SDK) | recursive-meta-agent (Python) |
| 架构   | Loop-based 状态机             | 递归函数                          |
| 复杂度  | 完整的 L1-L5 路线图              | 最小 L1 核心                      |
| 启动方式 | 需要启动 SDK 服务器               | 直接本地执行                        |


## 核心功能

- **Fetcher**: 从 arXiv API 抓取指定分类的最新论文
- **Screener**: 基于用户兴趣配置和知识库关键词筛选论文
- **Analyst**: 阅读并总结论文核心贡献，写入知识板块

## 项目结构

```
recursive_survey_agent/
├── .agent/                    # Agent 运行时状态与配置
│   └── AGENT.md              # 静态上下文（定义 Survey Workflow 及运行时配置）
├── skills/                   # 技能目录
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
├── data/                     # 运行时数据
│   ├── pdfs/                 # PDF 文件存储
│   ├── raw_papers_*.json    # 原始论文数据
│   └── run_log.jsonl        # 运行日志
├── knowledge_base/           # 知识板块目录
│   └── {topic}/
│       ├── meta.json         # 主题元信息
│       └── paper_*.md        # 论文总结
├── templates/                # 模板目录
│   └── paper_summary.md     # 论文总结模板
├── run.py                    # 入口脚本
├── tests/                    # 测试文件
│   ├── test_config.py       # 配置测试
│   └── test_structure.py    # 结构测试
└── README.md                 # 项目说明
```

> **注意**：以下目录在运行时会自动创建或使用：
>
> - `goals/` - 任务目标目录
> - `data/` - 运行时数据
> - `knowledge_base/` - 知识板块目录

## 快速开始

### 1. 依赖安装

```bash
pip install requests
```

### 2. 配置 LLM

通过环境变量配置 LLM：

```bash
export LLM_API_KEY=your_api_key
export LLM_MODEL="MiniMax-M2.5"
export LLM_BASE_URL="http://35.220.164.252:3888/v1"
```

或者编辑 `.agent/AGENT.md` 中的运行时配置：

```json
{
  "llm": {
    "baseUrl": "http://35.220.164.252:3888/v1",
    "model": "MiniMax-M2.5",
    "apiKey": "your_api_key"
  }
}
```

### 3. 运行 Survey Workflow

```bash
python run.py
```

## 使用方法

### 基本用法

```bash
# 执行一次完整的 Survey Workflow
python run.py
```

### 命令行参数


| 参数                 | 说明              | 示例                                    |
| ------------------ | --------------- | ------------------------------------- |
| `--max-results`    | 本次最大抓取篇数        | `--max-results 20`                    |
| `--start-date`     | 开始日期 (YYYYMMDD) | `--start-date 20260301`               |
| `--end-date`       | 结束日期 (YYYYMMDD) | `--end-date 20260303`                 |
| `--research-query` | 研究关键词           | `--research-query "video generation"` |
| `--debug`          | 启用调试模式          | `--debug`                             |
| `--recover`        | 从之前的运行恢复        | `--recover`                           |


### 配置修改

所有运行时配置（包括 topics 主题列表、抓取参数、权限级别等）都在 `.agent/AGENT.md` 的「运行时配置」块中维护。

修改主题配置：

```json
{
  "topics": [
    {
      "name": "Computer_Vision",
      "keywords": ["video generation", "diffusion"],
      "arxiv_categories": ["cs.CV"],
      "min_relevance_score": 0.7
    }
  ]
}
```

### 阈值配置


| 阈值项                     | 说明             | 默认值    |
| ----------------------- | -------------- | ------ |
| max_depth               | 最大递归深度         | 4      |
| max_retry               | 最大重试次数         | 3      |
| maxOutputLength         | 输出最大长度         | 102400 |
| context_budget_total    | 上下文总 token 预算  | 200000 |
| context_budget_reserved | 保留给输出的 token 数 | 4000   |


## 定制 Survey Agent

### 修改 Workflow

编辑 `.agent/AGENT.md` 中的 **Survey Workflow** 章节，修改工作流程的定义。

工作流程分为三个阶段：

1. **Fetcher** - 从 arXiv 抓取论文
2. **Screener** - 筛选论文
3. **Analyst** - 分析并写入知识库

### 修改 Skills

编辑 `skills/*/SKILL.md` 文件，修改各技能的说明和行为：

- `skills/arxiv_api/SKILL.md` - arXiv 抓取技能
- `skills/screening/SKILL.md` - 论文筛选技能
- `skills/writing/SKILL.md` - 论文总结写作技能
- `skills/pdf_extract/SKILL.md` - PDF 解析技能

### 配置知识板块

在 `knowledge_base/{topic}/meta.json` 中配置主题：

```json
{
  "name": "Computer_Vision",
  "description": "计算机视觉相关论文",
  "keywords": ["video generation", "diffusion", "image editing"],
  "arxiv_categories": ["cs.CV"],
  "paper_count": 0,
  "min_relevance_score": 0.6
}
```

## recursive-meta-agent 特性

本项目使用 `recursive-meta-agent` 作为后端，具有以下特性：

### 四个原语


| 原语                          | 说明          |
| --------------------------- | ----------- |
| `read(path)`                | 读取文件内容      |
| `write(path, content)`      | 写入文件        |
| `bash(command)`             | 执行 shell 命令 |
| `llm_call(context, prompt)` | 调用 LLM      |


### 设计原则

1. **目录树即任务树** - 任务结构、执行状态、中间结果全部体现在文件系统上
2. **Probe-first** - 第一个动作永远是以最小代价理解任务形状
3. **results.md 是节点类型签名** - 父节点只通过读取子节点的 results.md 消费结果
4. **LLMCall 是唯一随机性入口** - 其余一切保持确定性

## 测试

运行测试：

```bash
# 运行所有测试
python -m pytest tests/ -v

# 运行配置测试
python -m pytest tests/test_config.py -v

# 运行结构测试
python -m pytest tests/test_structure.py -v
```

## 注意事项

1. 使用前需确保 `recursive-meta-agent` 目录存在且包含 `main.py`
2. 需要配置有效的 LLM API Key（或通过环境变量设置）
3. arXiv API 有速率限制，建议每次请求间隔 3 秒以上
4. PDF 下载会占用较多存储空间，注意清理

## License

MIT License