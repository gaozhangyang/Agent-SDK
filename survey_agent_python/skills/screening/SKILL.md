# 论文筛选 Skill

本技能提供基于用户兴趣配置和知识库关键词筛选论文的能力。

## 技能用途

- 根据用户配置和知识库关键词筛选论文
- 基于分类标签进行初筛
- 计算论文与主题的相关度评分
- 黑名单过滤机制

## 筛选流程

```
1. 获取原始论文列表（从 arXiv API）
     ↓
2. 加载用户配置（user_config.json）
     ↓
3. 基于分类标签初筛
     ↓
4. 基于关键词匹配细筛
     ↓
5. 计算相关度评分
     ↓
6. 输出筛选结果
```

## 输入

- `raw_papers`: 原始论文列表（来自 fetch_arxiv）
- `config`: 用户配置（包含 topics 列表）
- `blacklist`: 黑名单 ID 列表
- `kb_dir`: 知识库目录（可选，用于加载主题关键词）

## 输出

筛选结果写入 JSON 文件：
```json
{
  "date": "2026-03-02",
  "count": 15,
  "papers": [
    {
      "arxiv_id": "2602.24289",
      "title": "Mode Seeking meets Mean Seeking for Fast Long Video Generation",
      "target_topic": "Computer_Vision",
      "relevance_score": 0.85,
      "matched_keywords": ["video generation", "diffusion"],
      "pdf_url": "https://arxiv.org/pdf/2602.24289.pdf"
    }
  ]
}
```

## 在本目录下运行脚本

### 命令行方式

```bash
python skills/screening/screen_papers.py data/raw_papers.json data/selected_papers.json
python skills/screening/screen_papers.py data/raw_papers.json data/selected_papers.json --threshold 0.7
python skills/screening/screen_papers.py data/raw_papers.json data/selected_papers.json --topics knowledge_base
```

参数说明：
- `input`: 输入 JSON 文件（原始论文）
- `output`: 输出 JSON 文件（筛选后的论文）
- `--config`: 配置文件路径（默认 `config/user_config.json`）
- `--blacklist`: 黑名单文件（默认 `data/blacklist.json`）
- `--topics`: 知识库目录（默认 `knowledge_base`）
- `--threshold`: 覆盖最小相关度评分

### Python 调用方式

```python
from skills.screening.screen_papers import screen_papers, load_config, load_blacklist
from pathlib import Path

# 加载配置
config = load_config(Path('config/user_config.json'))
blacklist = load_blacklist(Path('data/blacklist.json'))

# 筛选论文
selected = screen_papers(
    raw_papers=raw_papers,
    config=config,
    blacklist=blacklist,
    kb_dir=Path('knowledge_base')
)

print(f"筛选出 {len(selected)} 篇论文")
```

## 与其它技能的衔接

- **输入来源**: 消费 `skills/arxiv_api/` 的输出（原始论文列表）
- **输出给 writing**: 筛选后的论文传递给 `skills/writing/` 进行总结写作
- Pipeline 中的调用顺序：先执行 `fetch_arxiv` 抓取论文，再执行 `screen_papers` 筛选，最后执行分析

## 用户配置格式

`config/user_config.json`：

```json
{
  "topics": [
    {
      "name": "Computer_Vision",
      "keywords": ["video generation", "diffusion", "video synthesis", "long video"],
      "arxiv_categories": ["cs.CV"],
      "min_relevance_score": 0.7
    },
    {
      "name": "NLP_and_LLM",
      "keywords": ["language model", "LLM", "transformer", "attention"],
      "arxiv_categories": ["cs.CL", "cs.LG"],
      "min_relevance_score": 0.6
    }
  ],
  "daily_limit": 20,
  "blacklist": "data/blacklist.json"
}
```

## 关键词匹配策略

### 匹配优先级

1. **标题匹配**（权重 1.0）：权重最高，标题中的关键词最具代表性
2. **摘要匹配**（权重 0.8）：摘要中的关键词反映论文核心内容
3. **作者/引用匹配**（权重 0.5）：辅助判断论文相关性

### 相关度评分公式

```
score = Σ(keyword_weight × match_weight) / Σ(keyword_weight)
```

示例：
- 标题匹配 "video generation"：1.0 × 1.0 = 1.0
- 摘要匹配 "diffusion"：0.8 × 0.8 = 0.64
- 总分：(1.0 + 0.64) / 2 = 0.82

## 黑名单机制

`data/blacklist.json` 用于过滤低质量或无关论文：

```json
{
  "blacklist": [
    "2101.12345",
    "低质量期刊论文A"
  ],
  "reasons": {
    "2101.12345": "已被撤回"
  }
}
```

## 使用 SDK 进行智能筛选

可以通过 meta-agent-core SDK 调用 LLM 进行更深层次的论文相关性判断：

```python
from sdk_client import MetaAgentSDK

sdk = MetaAgentSDK("http://127.0.0.1:3890")

# 使用 LLM 判断论文相关性
result = sdk.run(
    goal=f"判断论文 '{paper['title']}' 是否与主题 '{topic_name}' 相关",
    workDir=str(project_dir),
    collectConfig={
        "sources": [
            {"type": "file", "query": "skills/screening/SKILL.md"},
            {"type": "file", "query": f"knowledge_base/{topic}/meta.json"}
        ]
    }
)
```
