# arXiv API 使用指南

本文件提供 arXiv API 的使用指南，供 Survey Agent 在检索学术论文时参考。

## arXiv API 基础

arXiv 提供免费的学术论文检索 API，地址：`http://export.arxiv.org/api/query`

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

## 使用 Python 调用

```python
import urllib.request
import xml.etree.ElementTree as ET

url = 'http://export.arxiv.org/api/query?search_query=cat:cs.CV&max_results=5'
response = urllib.request.urlopen(url)
data = response.read()
root = ET.fromstring(data)

for entry in root.findall('{http://www.w3.org/2005/Atom}entry'):
    title = entry.find('{http://www.w3.org/2005/Atom}title').text
    summary = entry.find('{http://www.w3.org/2005/Atom}summary').text
    print(f"Title: {title}")
    print(f"Summary: {summary[:200]}...")
```

## 注意事项

1. **速率限制**：官方建议每次请求间隔 3 秒以上
2. **结果分页**：单次最多返回 2000 条记录
3. **PDF 下载**：`http://arxiv.org/pdf/{arxiv_id}`
4. **API 文档**：`https://arxiv.org/help/api`
