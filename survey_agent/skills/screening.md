# 论文筛选工具说明

本文档说明 Survey Agent 如何基于用户兴趣配置和知识库关键词筛选论文。

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
  "blacklist": ["data/blacklist.json"]
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
    "2101.12345",  // arXiv ID
    "低质量期刊论文A"
  ],
  "reasons": {
    "2101.12345": "已被撤回"
  }
}
```

## 筛选输出

筛选结果写入 `data/selected_{date}.json`：

```json
{
  "date": "2026-03-02",
  "count": 15,
  "papers": [
    {
      "arxiv_id": "2602.24289",
      "title": "Mode Seeking meets Mean Seeking for Fast Long Video Generation",
      "category": "Computer_Vision",
      "relevance_score": 0.85,
      "matched_keywords": ["video generation", "diffusion"],
      "pdf_url": "https://arxiv.org/pdf/2602.24289.pdf"
    }
  ]
}
```

## 筛选脚本

使用 `scripts/screen_papers.py` 进行筛选：

```bash
python scripts/screen_papers.py --input data/raw_papers_2026-03-02.json --output data/selected_2026-03-02.json
```
