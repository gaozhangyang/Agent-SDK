# Survey Agent 系统设计文档

> 本文档用于指导实现一个基于 Agent Runtime Core SDK 的学术文献检索与知识管理系统。
> 实现者请完整阅读本文档后再开始编码。

---

## 〇、全系统架构总览

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          用户浏览器 (Frontend)                            │
│   知识板块展示 / 论文 Feed / 趋势图 / 运行状态面板 / 用户反馈操作          │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │  HTTP REST + SSE 长连接
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     Web API Server  (api_server.py)                      │
│                          FastAPI,  port 8000                             │
│                                                                          │
│   GET  /api/topics          → 读取所有 knowledge_base/*/meta.json        │
│   GET  /api/papers          → 读取所有 paper_*.md，解析为 JSON           │
│   GET  /api/run/status      → 查询当前 Agent 运行状态                    │
│   POST /api/run/trigger     → 手动触发一次完整流水线                     │
│   GET  /api/run/stream      → SSE 实时推送 Agent 进度事件               │
│   POST /api/papers/:id/feedback → 保存用户对论文的评分/标注              │
│   PUT  /api/config/topics   → 前端修改用户兴趣配置                       │
│   GET  /api/trends          → 计算关键词趋势，返回图表数据               │
└──────────┬─────────────────────────────────────┬────────────────────────┘
           │ 调用                                 │ 读写
           ▼                                     ▼
┌──────────────────────┐             ┌───────────────────────────────────┐
│  Agent Runtime Core  │             │         文件系统 / 数据层          │
│  SDK  port 3889      │             │                                   │
│                      │             │  knowledge_base/*/meta.json       │
│  POST /run           │             │  knowledge_base/*/paper_*.md      │
│  GET  /health        │             │  data/raw_papers_{date}.json      │
│                      │             │  data/selected_papers_{date}.json │
│  ┌─── Fetcher ───┐   │             │  data/run_log.jsonl               │
│  ├─── Screener ──┤   │             │  data/feedback.json               │
│  └─── Analyst ───┘   │             │  config/user_config.json          │
└──────────────────────┘             └───────────────────────────────────┘
```

**核心设计原则**：前端永远不直接操作文件系统，也不直接调用 SDK；API Server 是唯一的中间层，负责：
1. 将文件系统数据转为结构化 JSON 提供给前端
2. 将前端的用户意图转化为 Agent 的 goal 字符串
3. 将 Agent 的异步运行状态实时推送到前端（SSE）
4. 将用户反馈写回文件系统，影响下一次 Agent 的筛选行为

---

## 一、系统概述

### 目标

构建一个每日自动运行的文献检索 Agent 系统，完成以下工作：

1. 从 arXiv 获取最新论文摘要
2. 根据用户预设的研究兴趣主题，筛选高潜力论文
3. 下载并精读筛选出的论文
4. 将论文总结写入对应「知识板块」（文件夹）

### 知识板块结构

```
knowledge_base/
├── NLP_and_LLM/
│   ├── meta.json          # 板块描述、关键词、更新时间
│   ├── paper_001.md       # 论文总结
│   └── paper_002.md
├── Computer_Vision/
│   ├── meta.json
│   └── paper_001.md
└── Reinforcement_Learning/
    ├── meta.json
    └── paper_001.md
```

#### meta.json 格式

```json
{
  "name": "NLP and Large Language Models",
  "description": "研究自然语言处理、大型语言模型、提示工程等方向",
  "keywords": ["LLM", "transformer", "RLHF", "instruction tuning", "RAG"],
  "arxiv_categories": ["cs.CL", "cs.AI"],
  "created_at": "2025-01-01",
  "updated_at": "2025-07-20",
  "paper_count": 12
}
```

#### 论文总结 Markdown 格式（paper_xxx.md）

```markdown
# [论文标题]

**ArXiv ID**: 2501.12345
**发表日期**: 2025-07-20
**作者**: Author A, Author B
**原文链接**: https://arxiv.org/abs/2501.12345
**PDF 链接**: https://arxiv.org/pdf/2501.12345

## 研究问题
（一段话描述论文要解决什么问题）

## 核心方法
（方法、模型架构、关键创新点）

## 主要结论
（实验结果、性能提升数字、关键发现）

## 潜力评估
- **相关度评分**: 8/10
- **创新性**: 高
- **实用性**: 中
- **推荐理由**: （为什么这篇论文值得关注）

## 关键词标签
`keyword1` `keyword2` `keyword3`

## 引用
```bibtex
@article{...}
```
```

---

## 二、Agent 角色设计

系统由 **3 个 Agent** 组成，全部通过 SDK 的 `POST /run` 接口调用。

```
┌─────────────────────────────────────────────────────────┐
│                    定时调度器 (scheduler.py)              │
│                   每日 UTC 08:00 触发                     │
└─────────────┬───────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────┐
│   Agent 1: Fetcher      │  从 arXiv 抓取今日摘要列表
│   目标: 获取原始论文数据  │  输出: raw_papers.json
└─────────────┬───────────┘
              │
              ▼
┌─────────────────────────┐
│   Agent 2: Screener     │  结合知识板块 meta，评分筛选
│   目标: 筛选高潜力论文   │  输出: selected_papers.json
└─────────────┬───────────┘
              │ （对每篇选中论文）
              ▼
┌─────────────────────────┐
│   Agent 3: Analyst      │  下载PDF，阅读全文，生成总结
│   目标: 生成论文知识条目  │  输出: paper_xxx.md
└─────────────────────────┘
```

---

## 三、各 Agent 详细设计

### Agent 1: Fetcher（抓取器）

**职责**：调用 arXiv API，获取今日新发布的论文元信息（标题、摘要、作者、arXiv ID）

**工作目录**：`survey_agent/` 仓库根目录

**goal 字符串**：
```
从 arXiv 获取今日（{date}）最新发布的论文摘要列表。
目标分类: {arxiv_categories}
最多获取 {max_papers} 篇。
将结果写入 data/raw_papers_{date}.json，格式为论文对象数组。
```

**collectConfig.sources**：
```python
[
    {"type": "file", "query": "scripts/fetch_arxiv.py"},   # 抓取脚本
    {"type": "file", "query": "config/user_config.json"},  # 用户兴趣配置
    {"type": "bash", "query": "cat data/raw_papers_latest.json | head -50"},  # 上次样例参考
]
```

**产出文件**：`data/raw_papers_{date}.json`

```json
[
  {
    "arxiv_id": "2501.12345",
    "title": "...",
    "abstract": "...",
    "authors": ["Author A"],
    "submitted": "2025-07-20",
    "categories": ["cs.CL"],
    "pdf_url": "https://arxiv.org/pdf/2501.12345"
  }
]
```

---

### Agent 2: Screener（筛选器）

**职责**：读取 raw_papers，结合各知识板块的 meta.json，为每篇论文打分并分配到对应板块

**工作目录**：`survey_agent/`

**goal 字符串**：
```
阅读 data/raw_papers_{date}.json 中的论文摘要列表，结合 knowledge_base/ 下各板块的 meta.json 描述的研究兴趣。

评分标准：
1. 与板块关键词的相关度 (0-10)
2. 摘要中体现的创新性 (0-10)  
3. 实际应用潜力 (0-10)

任务：
- 为每篇论文选择最匹配的知识板块（可以无板块匹配则跳过）
- 综合评分 >= {threshold} 的论文才纳入
- 输出 data/selected_papers_{date}.json
- 每个板块每日最多纳入 {max_per_topic} 篇
```

**collectConfig.sources**：
```python
[
    {"type": "file", "query": f"data/raw_papers_{date}.json"},
    {"type": "bash", "query": "find knowledge_base -name 'meta.json' | xargs cat"},
    {"type": "bash", "query": f"ls knowledge_base/"},
]
```

**产出文件**：`data/selected_papers_{date}.json`

```json
[
  {
    "arxiv_id": "2501.12345",
    "title": "...",
    "abstract": "...",
    "pdf_url": "...",
    "target_topic": "NLP_and_LLM",
    "relevance_score": 8.5,
    "select_reason": "..."
  }
]
```

---

### Agent 3: Analyst（分析器）

**职责**：针对单篇论文，下载PDF，阅读全文，生成结构化总结，写入对应知识板块

**工作目录**：`survey_agent/`

**goal 字符串（每篇论文单独调用）**：
```
对论文 {arxiv_id}（标题：{title}）进行深度分析。

步骤：
1. 使用 scripts/download_pdf.py 下载 PDF 到 data/pdfs/{arxiv_id}.pdf
2. 使用 scripts/extract_text.py 提取 PDF 文本
3. 阅读全文，重点关注：Introduction、Method、Experiments、Conclusion
4. 按照 templates/paper_summary.md 模板生成论文总结
5. 将总结写入 knowledge_base/{target_topic}/paper_{arxiv_id}.md
6. 更新 knowledge_base/{target_topic}/meta.json 中的 updated_at 和 paper_count

相关度评分参考：{relevance_score}
筛选理由：{select_reason}
```

**collectConfig.sources**：
```python
[
    {"type": "file", "query": "templates/paper_summary.md"},
    {"type": "file", "query": f"knowledge_base/{target_topic}/meta.json"},
    {"type": "bash", "query": f"ls knowledge_base/{target_topic}/"},
    {"type": "bash", "query": f"python scripts/extract_text.py data/pdfs/{arxiv_id}.pdf | head -200"},
]
```

---

## 四、目录结构

```
survey_agent/                        # 工作目录（git 仓库）
├── main.py                          # 入口：定时调度，串联三个 Agent
├── config/
│   └── user_config.json             # 用户兴趣配置
├── scripts/
│   ├── fetch_arxiv.py               # arXiv API 封装
│   ├── download_pdf.py              # PDF 下载工具
│   └── extract_text.py             # PDF 文本提取（PyMuPDF）
├── templates/
│   └── paper_summary.md             # 论文总结模板
├── data/
│   ├── raw_papers_{date}.json       # Fetcher 输出
│   ├── selected_papers_{date}.json  # Screener 输出
│   └── pdfs/                        # 下载的 PDF 文件
└── knowledge_base/                  # 知识板块（见上方结构）
    ├── NLP_and_LLM/
    ├── Computer_Vision/
    └── Reinforcement_Learning/
```

---

## 五、用户配置文件（user_config.json）

```json
{
  "topics": [
    {
      "folder": "NLP_and_LLM",
      "name": "NLP and Large Language Models",
      "description": "大型语言模型、指令微调、对齐、推理优化",
      "keywords": ["LLM", "transformer", "RLHF", "RAG", "chain-of-thought", "fine-tuning"],
      "arxiv_categories": ["cs.CL", "cs.AI"],
      "max_papers_per_day": 3
    },
    {
      "folder": "Computer_Vision",
      "name": "Computer Vision",
      "description": "图像理解、目标检测、视觉生成模型",
      "keywords": ["diffusion", "ViT", "detection", "segmentation", "multimodal"],
      "arxiv_categories": ["cs.CV"],
      "max_papers_per_day": 2
    }
  ],
  "global_settings": {
    "fetch_max_papers": 100,
    "screening_threshold": 7.0,
    "schedule_utc_hour": 8,
    "llm": {
      "baseUrl": "http://35.220.164.252:3888/v1",
      "model": "MiniMax-M2.5",
      "apiKey": "your-api-key"
    },
    "sdk_url": "http://127.0.0.1:3889"
  }
}
```

---

## 六、主调度脚本（main.py 实现规范）

```python
"""
main.py — Survey Agent 调度入口

运行方式:
  python main.py              # 立即运行一次
  python main.py --schedule   # 启动定时调度（每日UTC 08:00）
"""

import json, requests
from datetime import date

SDK_URL = "http://127.0.0.1:3889"
WORK_DIR = "/path/to/survey_agent"


def run_agent(goal: str, sources: list, config: dict) -> dict:
    """调用 SDK /run 接口"""
    resp = requests.post(f"{SDK_URL}/run", json={
        "goal": goal,
        "workDir": WORK_DIR,
        "collectConfig": {"sources": sources, "maxTokens": 6000},
        "llm": config["global_settings"]["llm"],
        "thresholds": {
            "confidenceLow": 0.3,
            "maxIterations": 30,
            "maxNoProgress": 3
        }
    })
    return resp.json()


def run_daily(config: dict):
    today = date.today().isoformat()

    # === Step 1: Fetcher ===
    all_categories = list({c for t in config["topics"] for c in t["arxiv_categories"]})
    result = run_agent(
        goal=f"从arXiv获取{today}最新论文摘要，目标分类：{all_categories}，最多100篇，写入data/raw_papers_{today}.json",
        sources=[
            {"type": "file", "query": "scripts/fetch_arxiv.py"},
            {"type": "file", "query": "config/user_config.json"},
        ],
        config=config
    )
    if result["status"] != "completed":
        print(f"[Fetcher] failed: {result['status']} - {result.get('reason')}")
        return

    # === Step 2: Screener ===
    result = run_agent(
        goal=f"筛选data/raw_papers_{today}.json，结合knowledge_base各板块meta.json，评分阈值{config['global_settings']['screening_threshold']}，输出data/selected_papers_{today}.json",
        sources=[
            {"type": "file", "query": f"data/raw_papers_{today}.json"},
            {"type": "bash", "query": "find knowledge_base -name 'meta.json' | xargs cat"},
        ],
        config=config
    )
    if result["status"] != "completed":
        print(f"[Screener] failed: {result['status']} - {result.get('reason')}")
        return

    # === Step 3: Analyst（逐篇处理）===
    with open(f"data/selected_papers_{today}.json") as f:
        selected = json.load(f)

    for paper in selected:
        result = run_agent(
            goal=(
                f"深度分析论文 {paper['arxiv_id']}（{paper['title']}）："
                f"下载PDF，提取文本，生成结构化总结，"
                f"写入 knowledge_base/{paper['target_topic']}/paper_{paper['arxiv_id']}.md，"
                f"并更新该板块 meta.json"
            ),
            sources=[
                {"type": "file", "query": "templates/paper_summary.md"},
                {"type": "file", "query": f"knowledge_base/{paper['target_topic']}/meta.json"},
                {"type": "bash", "query": f"python scripts/extract_text.py data/pdfs/{paper['arxiv_id']}.pdf 2>/dev/null | head -300"},
            ],
            config=config
        )
        status = result["status"]
        print(f"[Analyst] {paper['arxiv_id']} → {status} (iter={result['state']['iterationCount']})")


if __name__ == "__main__":
    import sys
    with open("config/user_config.json") as f:
        config = json.load(f)

    if "--schedule" in sys.argv:
        import schedule, time
        hour = config["global_settings"]["schedule_utc_hour"]
        schedule.every().day.at(f"{hour:02d}:00").do(run_daily, config=config)
        print(f"Scheduled daily at UTC {hour:02d}:00. Waiting...")
        while True:
            schedule.run_pending()
            time.sleep(60)
    else:
        run_daily(config)
```

---

## 七、辅助脚本规范

### scripts/fetch_arxiv.py

使用 arXiv API（`http://export.arxiv.org/api/query`），参数：
- `search_query`: `cat:{category}` 或多分类用 OR 连接
- `sortBy=submittedDate`, `sortOrder=descending`
- `max_results=100`
- 解析返回的 Atom XML，提取 id/title/summary/authors/categories
- 输出 JSON 列表到 stdout 或指定文件

### scripts/download_pdf.py

```bash
# 用法
python scripts/download_pdf.py <arxiv_id> <output_path>
# 实现: requests.get(f"https://arxiv.org/pdf/{arxiv_id}", stream=True)
# 注意: 加 User-Agent header，加 retry 逻辑，超时 30s
```

### scripts/extract_text.py

```bash
# 用法
python scripts/extract_text.py <pdf_path>
# 依赖: PyMuPDF (pip install pymupdf)
# 输出: 纯文本到 stdout，保留段落结构
```

---

## 八、错误处理策略

| 场景 | 处理方式 |
|------|----------|
| Fetcher `escalated` | 记录日志，跳过当日，次日重试 |
| Fetcher `budget_exceeded` | 减少 `max_papers` 参数后重试 |
| Screener `escalated` | 降低 `screening_threshold` 0.5 分后重试 |
| Analyst `escalated` | 跳过该论文，记录到 `data/failed_{date}.log` |
| PDF 下载失败 | Analyst goal 中去掉 PDF 步骤，仅基于摘要生成总结（标注 "仅摘要版"） |

---

## 九、实现顺序建议

1. **初始化仓库**：创建目录结构，初始化 git，创建初始 meta.json
2. **实现辅助脚本**：fetch_arxiv.py → download_pdf.py → extract_text.py（先用单元测试验证）
3. **创建模板文件**：templates/paper_summary.md
4. **填写 user_config.json**：根据实际兴趣配置 topics 和 LLM 信息
5. **启动 SDK 服务**：`cd agent-runtime-core && npm run start:server`
6. **单独测试每个 Agent**：先手动调用 Fetcher，检查输出，再测 Screener，最后测 Analyst
7. **集成 main.py**：串联三个 Agent，测试完整流程
8. **启动定时调度**：`python main.py --schedule`

---

## 十、依赖清单（原始 Agent 部分）

```
requests>=2.31
pymupdf>=1.23
schedule>=1.2
feedparser>=6.0
agent-runtime-core  # SDK（Node.js），port 3889
git
```

---

## 十一、前后端通信层设计（api_server.py）

### 11.1 为什么需要 API Server

Agent SDK 是「任务执行」接口，同步阻塞直到完成，不对外暴露中间状态。而前端需要：
- **实时进度**：知道 Fetcher / Screener / Analyst 各自跑到哪了
- **数据读取**：把 Markdown 文件和 JSON 渲染成页面
- **反向驱动**：用户手动触发、修改配置、对论文打标反馈

因此需要一个 **API Server** 作为适配层，用 **SSE（Server-Sent Events）** 解决异步进度推送问题。

### 11.2 三层之间的完整数据流

```
浏览器                    api_server.py               Agent SDK / 文件系统
  │                            │                              │
  │─ GET /api/topics ─────────>│                              │
  │                            │── 扫描 knowledge_base/ ──>  │
  │<── topics JSON ────────────│<─ meta.json 列表 ───────────│
  │                            │                              │
  │─ POST /api/run/trigger ───>│                              │
  │<── { run_id } ─────────────│                              │
  │                            │                              │
  │─ GET /api/run/stream ──────│  (建立 SSE 长连接)           │
  │   (EventSource)            │                              │
  │                            │── POST /run (Fetcher) ──>   │
  │<── event:stage_start ──────│                              │
  │<── event:agent_progress ───│<── SDK traceJson 轮询 ──────│
  │<── event:stage_done ───────│<── 完成，写 raw_papers.json │
  │                            │── POST /run (Screener) ─>   │
  │<── event:stage_start ──────│                              │
  │<── event:stage_done ───────│<── 完成，写 selected.json ──│
  │                            │── POST /run (Analyst×N) ─>  │
  │<── event:paper_analyzed ───│<── 每篇完成，写 paper_*.md ─│
  │<── event:pipeline_done ────│                              │
  │                            │                              │
  │─ POST /api/papers/feedback>│                              │
  │                            │── 写 feedback.json ─────>   │
  │                            │── 写 blacklist.json ────>   │
  │                            │  (影响下次 Screener goal)    │
```

### 11.3 API 端点完整定义

**数据读取类**

```
GET  /api/topics
     扫描 knowledge_base/*/meta.json，返回所有板块列表
     Response: [ { id, name, description, keywords, paper_count, updated_at } ]

GET  /api/topics/:id/papers
     解析 knowledge_base/:id/paper_*.md 的 front-matter
     Query:  ?page=1&limit=20&sort=date|score
     Response: { papers: [...], total, page }

GET  /api/papers/:arxiv_id
     返回单篇论文完整内容（Markdown 转 HTML）
     Response: { arxiv_id, title, html_content, meta: {...} }

GET  /api/trends
     读取过去 N 天 selected_papers_{date}.json，聚合计算趋势
     Query: ?days=90
     Response: {
       daily_counts: { "2025-07-20": 5, ... },     # 热力图
       topic_monthly: { nlp: [6,8,7,9,11,10], ... }, # 折线图
       rising_keywords: [ { kw, delta_pct }, ... ]   # 上升关键词
     }

GET  /api/config
     返回 user_config.json（脱敏，隐藏 apiKey）

GET  /api/run/status
     返回当前或最近一次运行的状态快照
     Response: {
       run_id, status: "idle|running|completed|failed",
       stage: "fetcher|screener|analyst",
       progress: { current: 3, total: 8 },
       started_at, finished_at,
       summary: { fetched, selected, analyzed, failed }
     }

GET  /api/run/history
     读取 data/run_log.jsonl，返回历史运行记录
```

**操作触发类**

```
POST /api/run/trigger
     Body: { date?: string }
     后台线程启动完整流水线，立即返回 run_id
     同一时间只允许一个流水线运行，重复调用返回 409
     Response: { run_id: "run_20250720_143022", status: "started" }

PUT  /api/config/topics
     Body: { topics: [...] }
     覆盖写入 config/user_config.json，下次运行生效
     Response: { ok: true, effective_at: "next_run" }

POST /api/topics
     Body: { folder, name, description, keywords, arxiv_categories }
     创建新知识板块目录 + 初始 meta.json
     Response: { ok: true, topic_id: folder }
```

**用户反馈类**

```
POST /api/papers/:arxiv_id/feedback
     Body: { rating: 1-5, tags: ["useful"|"not_relevant"|"already_known"], note? }
     追加写入 data/feedback.json
     rating <= 2 时同步加入 data/blacklist.json
     Response: { ok: true }
```

### 11.4 SSE 事件流协议

前端通过 `new EventSource('/api/run/stream')` 建立长连接，Agent 运行期间接收：

```
event: pipeline_start
data: {"run_id":"run_20250720_143022","date":"2025-07-20","stages":["fetcher","screener","analyst"]}

event: stage_start
data: {"stage":"fetcher","message":"开始从 arXiv 抓取论文..."}

event: agent_progress
data: {"stage":"fetcher","iteration":3,"message":"已获取 45 篇摘要，继续抓取..."}

event: stage_done
data: {"stage":"fetcher","result":{"fetched":87},"duration_sec":23}

event: paper_analyzed
data: {"arxiv_id":"2501.12345","title":"...","topic":"NLP_and_LLM","score":8.7,"progress":{"current":3,"total":8}}

event: paper_failed
data: {"arxiv_id":"2501.99999","reason":"PDF download timeout"}

event: pipeline_done
data: {"run_id":"...","status":"completed","summary":{"fetched":87,"selected":12,"analyzed":11,"failed":1},"duration_sec":187}

event: heartbeat
data: {"ts":1721462400}
```

### 11.5 api_server.py 核心实现

```python
"""
api_server.py — Survey Agent Web API
运行: python api_server.py  (port 8000)
依赖: fastapi, uvicorn, python-frontmatter, markdown
"""
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import asyncio, json, threading
from pathlib import Path
from datetime import datetime

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

BASE = Path(__file__).parent
KB   = BASE / "knowledge_base"
DATA = BASE / "data"
CONFIG = BASE / "config" / "user_config.json"

# 全局运行状态（进程内单例）
run_state = {"status": "idle", "run_id": None, "stage": None,
             "progress": {"current": 0, "total": 0}, "summary": {},
             "started_at": None, "finished_at": None}

sse_clients: list[asyncio.Queue] = []   # 活跃 SSE 连接池
loop: asyncio.AbstractEventLoop = None  # 主事件循环引用


def broadcast(event: str, data: dict):
    """从后台线程向所有 SSE 客户端广播事件（线程安全）"""
    msg = f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
    for q in sse_clients:
        asyncio.run_coroutine_threadsafe(q.put(msg), loop)


def run_pipeline_thread(run_id: str, config: dict):
    """后台线程：执行完整 Agent 流水线，通过 broadcast 推送进度"""
    import requests as req
    SDK   = config["global_settings"]["sdk_url"]
    today = datetime.now().strftime("%Y-%m-%d")

    def sdk_run(goal, sources, msg=""):
        broadcast("agent_progress", {"stage": run_state["stage"], "message": msg})
        r = req.post(f"{SDK}/run", json={
            "goal": goal, "workDir": str(BASE),
            "collectConfig": {"sources": sources, "maxTokens": 6000},
            "llm": config["global_settings"]["llm"],
            "thresholds": {"maxIterations": 30, "maxNoProgress": 3}
        })
        return r.json()

    try:
        run_state["status"] = "running"
        broadcast("pipeline_start", {"run_id": run_id, "date": today})

        # ── Fetcher ──
        run_state["stage"] = "fetcher"
        broadcast("stage_start", {"stage": "fetcher", "message": "开始从 arXiv 抓取论文..."})
        cats = list({c for t in config["topics"] for c in t["arxiv_categories"]})
        res = sdk_run(
            f"从arXiv获取{today}最新论文，分类:{cats}，写入data/raw_papers_{today}.json",
            [{"type":"file","query":"scripts/fetch_arxiv.py"},
             {"type":"file","query":"config/user_config.json"}],
            "正在调用 arXiv API..."
        )
        if res["status"] != "completed":
            raise RuntimeError(f"Fetcher {res['status']}: {res.get('reason')}")
        raw_count = len(json.loads((DATA / f"raw_papers_{today}.json").read_text()))
        run_state["summary"]["fetched"] = raw_count
        broadcast("stage_done", {"stage": "fetcher", "result": {"fetched": raw_count}})

        # ── Screener ──
        run_state["stage"] = "screener"
        broadcast("stage_start", {"stage": "screener", "message": f"筛选 {raw_count} 篇论文..."})
        # 将用户黑名单注入 goal，实现反馈闭环
        bl_path = DATA / "blacklist.json"
        blacklist = json.loads(bl_path.read_text()) if bl_path.exists() else []
        bl_note = f"以下ID已被用户标记不相关，禁止纳入：{blacklist}" if blacklist else ""
        threshold = config["global_settings"]["screening_threshold"]
        res = sdk_run(
            f"筛选data/raw_papers_{today}.json，结合各板块meta.json，阈值{threshold}，"
            f"输出data/selected_papers_{today}.json。{bl_note}",
            [{"type":"file","query":f"data/raw_papers_{today}.json"},
             {"type":"bash","query":"find knowledge_base -name 'meta.json' | xargs cat"},
             {"type":"file","query":"data/blacklist.json"}],
            "LLM 正在对论文打分..."
        )
        if res["status"] != "completed":
            raise RuntimeError(f"Screener {res['status']}: {res.get('reason')}")
        selected = json.loads((DATA / f"selected_papers_{today}.json").read_text())
        run_state["summary"]["selected"] = len(selected)
        broadcast("stage_done", {"stage": "screener", "result": {"selected": len(selected)}})

        # ── Analyst（逐篇）──
        run_state["stage"] = "analyst"
        run_state["progress"] = {"current": 0, "total": len(selected)}
        broadcast("stage_start", {"stage": "analyst", "message": f"精读 {len(selected)} 篇论文..."})
        analyzed = failed = 0
        for i, paper in enumerate(selected):
            try:
                res = sdk_run(
                    f"深度分析 {paper['arxiv_id']}（{paper['title']}），下载PDF，生成总结，"
                    f"写入knowledge_base/{paper['target_topic']}/paper_{paper['arxiv_id']}.md，更新meta.json",
                    [{"type":"file","query":"templates/paper_summary.md"},
                     {"type":"file","query":f"knowledge_base/{paper['target_topic']}/meta.json"},
                     {"type":"bash","query":f"python scripts/extract_text.py data/pdfs/{paper['arxiv_id']}.pdf 2>/dev/null | head -300"}],
                    f"正在分析: {paper['title'][:40]}..."
                )
                if res["status"] == "completed":
                    analyzed += 1
                    broadcast("paper_analyzed", {
                        "arxiv_id": paper["arxiv_id"], "title": paper["title"],
                        "topic": paper["target_topic"], "score": paper.get("relevance_score"),
                        "progress": {"current": i+1, "total": len(selected)}
                    })
                else:
                    raise RuntimeError(res.get("reason"))
            except Exception as e:
                failed += 1
                broadcast("paper_failed", {"arxiv_id": paper["arxiv_id"], "reason": str(e)})
            run_state["progress"]["current"] = i + 1

        run_state.update({"status":"completed", "finished_at": datetime.now().isoformat()})
        run_state["summary"].update({"analyzed": analyzed, "failed": failed})
        broadcast("pipeline_done", {"run_id": run_id, "status": "completed", "summary": run_state["summary"]})

        # 写历史日志
        with open(DATA / "run_log.jsonl", "a") as f:
            f.write(json.dumps({"run_id": run_id, "date": today, "status": "completed",
                "summary": run_state["summary"], "started_at": run_state["started_at"],
                "finished_at": run_state["finished_at"]}, ensure_ascii=False) + "\n")

    except Exception as e:
        run_state["status"] = "failed"
        broadcast("pipeline_done", {"run_id": run_id, "status": "failed", "error": str(e)})


# ── API 路由 ──

@app.on_event("startup")
async def startup():
    global loop
    loop = asyncio.get_event_loop()


@app.post("/api/run/trigger")
async def trigger_run():
    if run_state["status"] == "running":
        raise HTTPException(409, "Pipeline already running")
    run_id = f"run_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    run_state.update({"run_id": run_id, "started_at": datetime.now().isoformat(),
                       "status": "starting", "summary": {}})
    with open(CONFIG) as f:
        config = json.load(f)
    threading.Thread(target=run_pipeline_thread, args=(run_id, config), daemon=True).start()
    return {"run_id": run_id, "status": "started"}


@app.get("/api/run/stream")
async def run_stream():
    q = asyncio.Queue()
    sse_clients.append(q)
    async def gen():
        try:
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=15)
                    yield msg
                except asyncio.TimeoutError:
                    yield f"event: heartbeat\ndata: {json.dumps({'ts': int(datetime.now().timestamp())})}\n\n"
        finally:
            if q in sse_clients:
                sse_clients.remove(q)
    return StreamingResponse(gen(), media_type="text/event-stream",
                              headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no"})


@app.get("/api/run/status")
async def run_status():
    return run_state


@app.get("/api/topics")
async def get_topics():
    result = []
    for meta_path in sorted(KB.glob("*/meta.json")):
        meta = json.loads(meta_path.read_text())
        meta["id"] = meta_path.parent.name
        meta["paper_count"] = len(list(meta_path.parent.glob("paper_*.md")))
        result.append(meta)
    return result


@app.get("/api/topics/{topic_id}/papers")
async def get_papers(topic_id: str, page: int = 1, limit: int = 20):
    import frontmatter
    topic_dir = KB / topic_id
    if not topic_dir.exists():
        raise HTTPException(404, "Topic not found")
    papers = []
    for p in sorted(topic_dir.glob("paper_*.md"), reverse=True):
        post = frontmatter.load(str(p))
        papers.append({**post.metadata, "preview": post.content[:300]})
    return {"papers": papers[(page-1)*limit : page*limit], "total": len(papers), "page": page}


@app.post("/api/papers/{arxiv_id}/feedback")
async def save_feedback(arxiv_id: str, body: dict):
    fb_path = DATA / "feedback.json"
    feedback = json.loads(fb_path.read_text()) if fb_path.exists() else {}
    feedback[arxiv_id] = {**body, "ts": datetime.now().isoformat()}
    fb_path.write_text(json.dumps(feedback, ensure_ascii=False, indent=2))
    if body.get("rating", 5) <= 2:
        bl_path = DATA / "blacklist.json"
        bl = json.loads(bl_path.read_text()) if bl_path.exists() else []
        if arxiv_id not in bl:
            bl.append(arxiv_id)
            bl_path.write_text(json.dumps(bl, indent=2))
    return {"ok": True}


@app.put("/api/config/topics")
async def update_config(body: dict):
    with open(CONFIG) as f:
        config = json.load(f)
    config["topics"] = body["topics"]
    with open(CONFIG, "w") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    return {"ok": True, "effective_at": "next_run"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

### 11.6 前端消费 SSE 的关键代码

```javascript
// 1. 手动触发运行
async function triggerRun() {
  const r = await fetch('/api/run/trigger', { method: 'POST' });
  const { run_id } = await r.json();
  connectSSE(run_id);
}

// 2. 建立 SSE 连接，绑定所有事件
function connectSSE(run_id) {
  const es = new EventSource('/api/run/stream');

  es.addEventListener('pipeline_start', e => {
    showRunPanel(JSON.parse(e.data));           // 显示进度面板
    setStageStatus('fetcher', 'active');
  });

  es.addEventListener('stage_done', e => {
    const d = JSON.parse(e.data);
    setStageStatus(d.stage, 'done', d.result); // 阶段打钩
    const next = {fetcher:'screener', screener:'analyst'}[d.stage];
    if (next) setStageStatus(next, 'active');
  });

  es.addEventListener('paper_analyzed', e => {
    const d = JSON.parse(e.data);
    updateProgressBar(d.progress.current, d.progress.total);
    prependPaperCard(d);        // 实时插入论文卡片，无需刷页
  });

  es.addEventListener('pipeline_done', e => {
    const d = JSON.parse(e.data);
    showRunSummary(d.summary);
    es.close();
    refreshTopics();            // 重新拉取 /api/topics 更新计数
  });
}

// 3. 用户对论文打标反馈
async function submitFeedback(arxivId, rating, tags) {
  await fetch(`/api/papers/${arxivId}/feedback`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ rating, tags })
  });
  // rating <= 2 时，前端可立即在 UI 上标灰该卡片
  if (rating <= 2) markPaperIrrelevant(arxivId);
}
```

---

## 十二、用户反馈闭环（影响 Agent 决策）

用户对论文的操作会在**下一次运行时**实际影响 Agent 的 goal 构造：

```
用户标记「不相关」(rating ≤ 2)
        │
        ▼  POST /api/papers/2501.xxxxx/feedback
        │  api_server 写入 data/blacklist.json
        │
        ▼  下次 run_pipeline_thread 构造 Screener goal 时：
           goal 字符串追加：
           "以下 arXiv ID 已被用户标记为不相关，禁止纳入：[2501.xxxxx]"
           sources 追加：{"type":"file","query":"data/blacklist.json"}
        │
        ▼  Agent 自动规避这些论文

用户给出 5 星好评
        │
        ▼  高分论文标题写入 data/feedback.json
        │
        ▼  Screener goal 追加：
           "以下论文受到用户高度评价，请优先关注同类方向：{high_rated_titles}"
```

---

## 十三、前端需新增的交互模块

在原有博客展示页面基础上，补充以下三个模块：

**① 运行状态悬浮面板**（右下角，SSE 驱动）
```
┌─────────────────────────────────────────────────┐
│  ● 运行中  run_20250720_143022             [×]  │
├─────────────────────────────────────────────────┤
│  ✓ Fetcher   抓取 87 篇           [完成 23s]   │
│  ✓ Screener  筛出 12 篇           [完成 41s]   │
│  ● Analyst   3 / 12               [进行中]     │
│    └─ 正在分析: Chain-of-Thought...            │
│  ░░░░░░░░░░░░░░░░░░░░  25%                     │
└─────────────────────────────────────────────────┘
```

**② 论文卡片操作区**（Modal 底部）
```
[ ★★★★☆ ]  [ 🏷 不相关 ]  [ 📌 已知晓 ]  [ 在 arXiv 查看 ]
```
点击后调用 `POST /api/papers/:id/feedback`。

**③ Settings 面板**
- 增删知识板块（调用 `POST /api/topics`）
- 修改关键词和 arXiv 分类
- 调整筛选阈值
- 设置定时时间
- 手动触发按钮（调用 `POST /api/run/trigger`）

---

## 十四、更新后的完整目录结构

```
survey_agent/
├── main.py                     # 定时调度（保持不变，复用 run_daily 逻辑）
├── api_server.py               # ★ Web API Server（FastAPI，port 8000）
├── config/
│   └── user_config.json
├── scripts/
│   ├── fetch_arxiv.py
│   ├── download_pdf.py
│   └── extract_text.py
├── templates/
│   └── paper_summary.md
├── data/
│   ├── raw_papers_{date}.json
│   ├── selected_papers_{date}.json
│   ├── run_log.jsonl           # ★ 历史运行日志
│   ├── feedback.json           # ★ 用户反馈数据
│   ├── blacklist.json          # ★ 不相关论文黑名单
│   └── pdfs/
├── frontend/
│   └── index.html              # ★ 前端（对接 /api/* 端点）
└── knowledge_base/
    ├── NLP_and_LLM/
    └── ...
```

---

## 十五、完整依赖清单

```
# Agent + API Server
requests>=2.31
pymupdf>=1.23
schedule>=1.2
feedparser>=6.0
fastapi>=0.110
uvicorn>=0.27
python-frontmatter>=1.0    # 解析 Markdown front-matter
markdown>=3.5              # Markdown 转 HTML

# 系统服务
agent-runtime-core         # SDK（Node.js），port 3889
git                        # workDir 必须是 git 仓库
```

---

## 十六、实现顺序（更新版）

1. **初始化仓库**：目录结构、git init、初始 meta.json
2. **实现辅助脚本**：fetch_arxiv.py → download_pdf.py → extract_text.py
3. **启动 SDK**：`cd agent-runtime-core && npm run start:server`
4. **测试 Agent 流水线**：`python main.py`，验证三阶段输出文件
5. **实现 api_server.py**：先跑通 `/api/topics` 和 `/api/run/trigger` 基础路由
6. **接入 SSE**：实现 `/api/run/stream`，用 curl 验证事件推送
7. **前端对接**：将 `index.html` 的静态数据替换为 `/api/*` 动态请求，接入 EventSource
8. **实现反馈闭环**：接通 `/api/papers/feedback`，验证黑名单在下次运行中生效
9. **启动定时调度**：`python main.py --schedule` 或 `python api_server.py`（含内置调度）

---

## 附：快速验证命令

```bash
# 1. 检查 SDK 健康
curl http://127.0.0.1:3889/health

# 2. 启动 API Server
python api_server.py

# 3. 手动触发一次运行
curl -X POST http://localhost:8000/api/run/trigger

# 4. 监听 SSE 实时输出
curl -N http://localhost:8000/api/run/stream

# 5. 查看知识板块列表
curl http://localhost:8000/api/topics | python -m json.tool

# 6. 模拟用户反馈（标记不相关）
curl -X POST http://localhost:8000/api/papers/2501.12345/feedback \
     -H "Content-Type: application/json" \
     -d '{"rating": 1, "tags": ["not_relevant"]}'
```
