# Survey Agent Python

> 纯 Python 实现的 Survey Agent，通过 AGENT.md + skills 驱动 workflow，实现自动化学术文献检索与知识管理。

## 核心设计 代码只做「理念

**Python容器 + 接口」，具体 workflow 主要通过 AGENT 配置和 skills 文档来驱动。**

- `.agent/AGENT.md` 定义了 Survey Workflow 的完整规范（Fetcher → Screener → Analyst）
- `skills/` 目录下各技能定义了具体实现细节
- Python 代码（api_server.py）仅提供 HTTP API 接口和 SDK 胶水层

## 核心功能

- **Fetcher**: 从 arXiv API 抓取指定分类的最新论文
- **Screener**: 基于用户兴趣配置和知识库关键词筛选论文
- **Analyst**: 调用 meta-agent-core SDK 阅读并总结论文核心贡献，写入知识板块

## 项目结构

```
survey_agent_python/
├── .agent/                    # Agent 运行时状态与配置
│   ├── AGENT.md              # 静态上下文（定义 Survey Workflow）
│   ├── state.json            # State 快照
│   ├── trace.jsonl           # 推理轨迹（JSON 格式，跨 Session 累积）
│   ├── terminal.md           # Terminal Log 执行日志（Markdown 格式）
│   └── memory.jsonl          # Memory 长期记忆
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
├── scripts/                  # 工具脚本
│   └── download_pdf.py      # PDF 下载
├── templates/                # 模板目录
│   └── paper_summary.md     # 论文总结模板
├── knowledge_base/           # 知识板块目录
│   └── {topic}/
│       ├── meta.json         # 板块元信息
│       └── paper_*.md        # 论文总结
├── data/                    # 运行时数据
│   ├── pdfs/                # PDF 文件存储
│   ├── raw_papers_*.json    # 原始抓取数据
│   ├── selected_*.json      # 筛选后数据
│   ├── feedback.json        # 用户反馈
│   └── blacklist.json       # 黑名单
├── sdk_client.py             # meta-agent-core SDK Python 封装
├── api_server.py             # FastAPI Web 服务器 (端口 8001)
├── config/
│   └── user_config.json     # 用户配置
└── README.md
```

## 快速开始

### 1. 依赖安装

```bash
pip install fastapi uvicorn requests pydantic
```

### 2. 配置 LLM

编辑 `config/user_config.json`，配置有效的 LLM API Key：

```json
{
  "global_settings": {
    "llm": {
      "baseUrl": "http://35.220.164.252:3888/v1",
      "model": "MiniMax-M2.5",
      "apiKey": "your-valid-api-key"
    }
  }
}
```

### 3. 启动 SDK 服务

```bash
cd meta-agent-core && npm run start:server
```

### 4. 启动 API 服务器

```bash
python api_server.py
```

服务将在 `http://0.0.0.0:8001` 启动。

## 使用方法

### API 接口

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/topics` | GET | 获取所有知识板块 |
| `/api/topics/{topic_id}/papers` | GET | 获取指定板块的论文列表 |
| `/api/papers/{arxiv_id}` | GET | 获取单篇论文详情 |
| `/api/run/status` | GET | 获取当前运行状态 |
| `/api/run/trigger` | POST | 手动触发一次完整流水线 |
| `/api/run/stream` | GET | SSE 实时推送 Agent 进度事件 |
| `/api/papers/{arxiv_id}/feedback` | POST | 保存用户对论文的评分 |
| `/api/config` | GET | 获取配置（脱敏） |
| `/api/config/topics` | PUT | 更新主题配置 |
| `/api/trends` | GET | 获取趋势数据 |
| `/api/health` | GET | 健康检查 |

### 触发流水线

```bash
curl -X POST http://localhost:8001/api/run/trigger \
  -H "Content-Type: application/json" \
  -d '{"max_results": 5}'
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

### 配置用户偏好

编辑 `config/user_config.json`：

```json
{
  "topics": [
    {
      "name": "Computer_Vision",
      "keywords": ["video generation", "diffusion"],
      "arxiv_categories": ["cs.CV"],
      "min_relevance_score": 0.7
    }
  ],
  "global_settings": {
    "fetch_max_papers": 10,
    "screening_threshold": 0.6,
    "llm": {...},
    "sdk_url": "http://127.0.0.1:3890"
  }
}
```

## Session 恢复机制

Survey Agent 支持跨 HTTP 请求的 Session 恢复：

- **State 恢复**：每次运行结束后，State 会持久化到 `.agent/state.json`
- **Trace 累积**：推理轨迹追加写到 `.agent/trace.jsonl`，跨 Session 累积
- **Terminal Log 累积**：执行日志追加写到 `.agent/terminal.md`（Markdown 格式）
- **Memory 累积**：长期记忆追加写到 `.agent/memory.jsonl`

## 设计原则

1. **Workflow 驱动**：具体的工作流程通过 AGENT.md + skills 文档定义，而不是硬编码在 Python 代码中
2. **Skills 作为可组合能力单元**：每个 Skill 独立定义职责，通过 CollectConfig 组合使用
3. **Python 薄封装**：Python 代码只提供运行时容器、API 接口和少量胶水逻辑
4. **修改优先序**：业务逻辑修改应优先改 AGENT.md 和 skills，而不是改 Python 源码

## 注意事项

1. 使用前需确保 meta-agent-core SDK 服务已启动
2. 需要配置有效的 LLM API Key
3. arXiv API 有速率限制，建议每次请求间隔 3 秒以上
4. PDF 下载会占用较多存储空间，注意清理

## License

MIT License
