# Survey Agent Python

> 纯 Python 实现的 Survey Agent，通过 AGENT.md + skills 驱动 workflow，实现自动化学术文献检索与知识管理。

## 核心设计

**Python 代码只做「容器 + 接口」，具体 workflow 主要通过 AGENT 配置和 skills 文档来驱动。**

- `.agent/AGENT.md` 定义了 Survey Workflow 的完整规范（Fetcher → Screener → Analyst）及运行时配置
- `skills/` 目录下各技能定义了具体实现细节
- `run.py` 是唯一入口脚本，执行 `python run.py` 即可运行

## 核心功能

- **Fetcher**: 从 arXiv API 抓取指定分类的最新论文
- **Screener**: 基于用户兴趣配置和知识库关键词筛选论文
- **Analyst**: 调用 meta-agent-core SDK 阅读并总结论文核心贡献，写入知识板块

## 项目结构

```
survey_agent_python/
├── .agent/                    # Agent 运行时状态与配置
│   ├── AGENT.md              # 静态上下文（定义 Survey Workflow 及运行时配置）
│   ├── state.json            # State 快照（首次运行后生成）
│   ├── trace.jsonl           # 推理轨迹（首次运行后生成）
│   └── terminal.md           # Terminal Log（首次运行后生成）
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
├── run.py                    # 入口脚本
└── README.md                 # 项目说明
```

> **注意**：以下目录在运行时会自动创建或使用：
> - `data/` - 运行时数据（原始论文、筛选结果、PDF 等）
> - `knowledge_base/` - 知识板块目录
> - `templates/` - 模板目录

## 快速开始

### 1. 依赖安装

```bash
pip install requests
```

### 2. 配置 LLM

编辑 `.agent/AGENT.md`，在「运行时配置」中配置 LLM：

```json
{
  "llm": {
    "baseUrl": "http://35.220.164.252:3888/v1",
    "model": "MiniMax-M2.5",
    "apiKey": "your-valid-api-key"
  }
}
```

**敏感信息**：也可以通过环境变量 `LLM_API_KEY` 覆盖，避免密钥进入仓库。

### 3. 启动 SDK 服务

```bash
cd meta-agent-core && npm run start:server
```

### 4. 运行 Survey Workflow

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

| 参数 | 说明 | 示例 |
|------|------|------|
| `--max-results` | 本次最大抓取篇数 | `--max-results 20` |
| `--start-date` | 开始日期 (YYYYMMDD) | `--start-date 20260301` |
| `--end-date` | 结束日期 (YYYYMMDD) | `--end-date 20260303` |
| `--research-query` | 研究关键词 | `--research-query "video generation"` |
| `--debug` | 启用调试模式 | `--debug` |

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

修改权限配置（定义 Agent 可执行的操作范围）：

```json
{
  "strategies": {
    "permissions": 3
  }
}
```

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

## Session 恢复机制

Survey Agent 支持 Session 恢复：

- **State 恢复**：每次运行结束后，State 会持久化到 `.agent/state.json`
- **Trace 累积**：推理轨迹追加写到 `.agent/trace.jsonl`，跨 Session 累积
- **Terminal Log 累积**：执行日志追加写到 `.agent/terminal.md`（Markdown 格式）

## 设计原则

1. **Workflow 驱动**：具体的工作流程通过 AGENT.md + skills 文档定义，而不是硬编码在 Python 代码中
2. **Skills 作为可组合能力单元**：每个 Skill 独立定义职责，通过 CollectConfig 组合使用
3. **Python 薄封装**：Python 代码只提供运行时容器和少量胶水逻辑
4. **修改优先序**：业务逻辑修改应优先改 AGENT.md 和 skills，而不是改 Python 源码
5. **配置集中管理**：所有运行时配置集中在 AGENT.md 中，无独立的配置文件

## 注意事项

1. 使用前需确保 meta-agent-core SDK 服务已启动
2. 需要配置有效的 LLM API Key（或通过环境变量设置）
3. arXiv API 有速率限制，建议每次请求间隔 3 秒以上
4. PDF 下载会占用较多存储空间，注意清理

## License

MIT License
