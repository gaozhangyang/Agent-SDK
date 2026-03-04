# arXiv API Skill

本技能提供从 arXiv API 抓取学术论文的能力，供 Survey Agent 在检索学术论文时使用。

## 技能用途

- 从 arXiv API 抓取指定分类的最新论文
- 支持日期范围、关键词搜索等高级查询
- 输出结构化的论文元数据（标题、摘要、作者、分类、PDF链接等）

## 输入

- `categories`: arXiv 分类列表，如 `['cs.CV', 'cs.LG']`
- `max_results`: 最大返回数量（默认 10）
- `start_date`: 开始日期 (YYYYMMDD)
- `end_date`: 结束日期 (YYYYMMDD)
- `search_query`: 搜索关键词

## 输出

返回论文列表，每篇论文包含：
```json
{
    "arxiv_id": "2602.12345",
    "title": "论文标题",
    "summary": "论文摘要",
    "authors": ["作者1", "作者2"],
    "categories": ["cs.CV", "cs.LG"],
    "published": "2026-02-01",
    "pdf_url": "https://arxiv.org/pdf/2602.12345.pdf"
}
```

## 在本目录下运行脚本

### 命令行方式

```bash
python skills/arxiv_api/fetch_arxiv.py -c cs.CV,cs.LG -m 10 -o data/raw_papers.json
python skills/arxiv_api/fetch_arxiv.py -c cs.CV -s 20260101 -e 20260301 -m 20 -o data/raw_papers.json
```

参数说明：
- `-c, --categories`: arXiv 分类（逗号分隔）
- `-m, --max-results`: 最大返回数量（默认 10）
- `-s, --start-date`: 开始日期 (YYYYMMDD)
- `-e, --end-date`: 结束日期 (YYYYMMDD)
- `-q, --query`: 搜索查询关键词
- `-o, --output`: 输出 JSON 文件路径

### Python 调用方式

```python
from skills.arxiv_api.fetch_arxiv import fetch_papers, save_papers
from pathlib import Path

# 获取最近 5 篇计算机视觉论文
papers = fetch_papers(
    categories=['cs.CV'],
    max_results=5,
    start_date='20260101'
)

for paper in papers:
    print(f"{paper['arxiv_id']}: {paper['title']}")

# 保存到文件
save_papers(papers, Path('data/raw_papers.json'))
```

## 与其它技能的衔接

- **输出给 screening**: 本技能的输出（原始论文列表）传递给 `skills/screening/` 进行筛选
- Pipeline 中的调用顺序：先执行 `fetch_arxiv` 抓取论文，再执行 `screen_papers` 筛选

## arXiv API 基础

### 查询参数

| 参数 | 说明 | 示例 |
|------|------|------|
| search_query | 查询语句 | `all:CNN` 表示在所有字段搜索 CNN |
| start | 返回结果起始位置 | `start=0` |
| max_results | 最大返回数量 | `max_results=10` |
| sortBy | 排序字段 | `submittedDate`、`lastUpdatedDate`、`relevance` |
| sortOrder | 排序顺序 | `ascending`、`descending` |

### 查询语法

- **字段搜索**：`ti:CNN`（标题）、`au:Zhang`（作者）、`abs:learning`（摘要）
- **逻辑运算符**：`AND`、`OR`、`ANDNOT`
- **示例**：`search_query=cat:cs.CV+AND+abs:video+generation`

### 分类标签（部分）

| 分类 | 说明 |
|------|------|
| cs.CV | Computer Vision |
| cs.CL | Computation and Language |
| cs.LG | Machine Learning |
| cs.AI | Artificial Intelligence |
| stat.ML | Machine Learning (Statistics) |

## 注意事项

1. **速率限制**：官方建议每次请求间隔 3 秒以上
2. **结果分页**：单次最多返回 2000 条记录
3. **PDF 下载**：`http://arxiv.org/pdf/{arxiv_id}`
4. **API 文档**：`https://arxiv.org/help/api`
