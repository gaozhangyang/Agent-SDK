# 论文总结写作 Skill

本技能提供论文总结的写作模板和指南，供 Survey Agent 在生成知识库文档时参考。

## 技能用途

- 基于 PDF 内容生成论文总结
- 按照标准模板格式化输出
- 更新知识库元信息

## 输入

- `arxiv_id`: 论文的 arXiv ID
- `pdf_path`: PDF 文件路径
- `target_topic`: 目标知识板块
- `relevance_score`: 相关度评分（可选）

## 输出

论文总结写入 `knowledge_base/{topic}/paper_{arxiv_id}.md`：

```markdown
# {论文标题}

**ArXiv ID**: {arxiv_id}  
**发表日期**: {YYYY年MM月}  
**作者**: {作者列表}  
**原文链接**: https://arxiv.org/abs/{arxiv_id}  
**PDF 链接**: https://arxiv.org/pdf/{arxiv_id}.pdf

## 研究问题

简要描述论文要解决的问题（1-2句话）。

## 核心方法

### 主要创新点

- 创新点1：...
- 创新点2：...

### 技术细节

简述关键技术实现（可选，过于技术的内容可省略）。

## 主要结论

### 实验结果

- 结果1：...
- 结果2：...

### 关键发现

- 发现1：...

## 潜力评估

- **相关度评分**: X/10
- **创新性**: 高/中/低
- **实用性**: 高/中/低

## 相关工作

提及相关的重要工作（可选）。
```

## 模板文件

本技能的写作模板位于：
- 项目级模板（全局引用）：`templates/paper_summary.md`
- 也可在本技能目录中创建本地模板

## 在本目录下运行脚本

本技能主要通过 SDK 调用 LLM 进行写作，没有独立的命令行脚本。

### SDK 调用方式

```python
from sdk_client import MetaAgentSDK

sdk = MetaAgentSDK("http://127.0.0.1:3890")

# 使用 LLM 生成论文总结
result = sdk.run(
    goal=f"深度分析论文 {arxiv_id}，PDF已下载到 {pdf_path}，"
         f"生成总结，写入 knowledge_base/{target_topic}/paper_{arxiv_id}.md，"
         f"更新 meta.json",
    workDir=str(project_dir),
    collectConfig={
        "sources": [
            {"type": "file", "query": "templates/paper_summary.md"},
            {"type": "file", "query": f"knowledge_base/{target_topic}/meta.json"},
            {"type": "skills", "query": "writing"},
        ],
        "maxTokens": 6000
    }
)
```

## 与其它技能的衔接

- **输入来源**: 消费 `skills/screening/` 的输出（筛选后的论文列表）
- **可选输入**: 可以结合 `skills/pdf_extract/` 将 PDF 提取为文本后再分析
- **输出目标**: 写入 `knowledge_base/{topic}/paper_{arxiv_id}.md`，更新 `meta.json`

## 写作要点

### 1. 研究问题

- 用通俗语言描述问题背景
- 突出研究动机和价值
- 控制在 1-2 句话

### 2. 核心方法

- 提炼论文的核心创新点
- 避免过度深入技术细节
- 强调方法的优势

### 3. 主要结论

- 总结关键实验结果
- 量化表达（如性能提升 X%）
- 指出适用范围

### 4. 潜力评估

- 相关度评分：与当前研究领域的匹配程度
- 创新性：方法的新颖程度
- 实用性：实际应用的可行性

## 知识库更新

完成论文总结后，需要更新对应知识板块的 `meta.json`：

```json
{
  "topic": "Computer_Vision",
  "papers": [
    {
      "arxiv_id": "2602.24289",
      "title": "Mode Seeking meets Mean Seeking for Fast Long Video Generation",
      "date_added": "2026-03-02",
      "relevance_score": 0.85
    }
  ]
}
```
