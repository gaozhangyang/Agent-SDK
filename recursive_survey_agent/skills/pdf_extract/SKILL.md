# PDF 解析为文档 Skill

本技能提供将 PDF 解析为纯文本或结构化文档的能力，供下游 writing 或 collectConfig 的 file 来源使用。

## 技能用途

- 将 PDF 文件解析为纯文本
- 支持指定页码范围提取
- 支持保留或简化布局
- 供 Agent 分析和总结 PDF 内容

## 输入

- `pdf_path`: PDF 文件路径
- `start_page`: 开始页码（可选，默认 1）
- `end_page`: 结束页码（可选，默认最后一页）
- `max_pages`: 最大页数限制（可选）
- `preserve_layout`: 是否保留布局（可选，默认 False）

## 输出

提取的文本：
- 标准输出或写入文件（如 `data/pdfs/{arxiv_id}.txt` 或 `.md`）

## 依赖

```bash
pip install pymupdf
```

## 在本目录下运行脚本

### 命令行方式

```bash
# 提取整个 PDF
python skills/pdf_extract/extract_text.py data/pdfs/2602.24289.pdf

# 提取指定页码范围
python skills/pdf_extract/extract_text.py data/pdfs/2602.24289.pdf --start-page 1 --end-page 10

# 提取前 5 页
python skills/pdf_extract/extract_text.py data/pdfs/2602.24289.pdf --max-pages 5

# 输出到文件
python skills/pdf_extract/extract_text.py data/pdfs/2602.24289.pdf -o data/pdfs/2602.24289.txt

# 保留布局
python skills/pdf_extract/extract_text.py data/pdfs/2602.24289.pdf --preserve-layout
```

参数说明：
- `pdf_path`: PDF 文件路径（必需）
- `-o, --output`: 输出文件路径（默认输出到标准输出）
- `-s, --start-page`: 开始页码（默认 1）
- `-e, --end-page`: 结束页码（默认最后一页）
- `-m, --max-pages`: 最大页数限制
- `-p, --preserve-layout`: 保留原始布局格式

### Python 调用方式

```python
from skills.pdf_extract.extract_text import extract_text, extract_text_from_pdf

# 基本用法
text = extract_text_from_pdf("data/pdfs/2602.24289.pdf")
print(text[:500])

# 指定页码范围
text = extract_text_from_pdf(
    "data/pdfs/2602.24289.pdf",
    start_page=1,
    end_page=10
)

# 保留布局
text = extract_text_from_pdf(
    "data/pdfs/2602.24289.pdf",
    preserve_layout=True
)

# 保存到文件
extract_text(
    "data/pdfs/2602.24289.pdf",
    output_path="data/pdfs/2602.24289.txt"
)
```

## 与其它技能的衔接

- **输入来源**: 消费 PDF 文件（通常由 `scripts/download_pdf.py` 下载）
- **输出给 writing**: 提取的文本可作为 `skills/writing/` 的输入，供 LLM 分析总结
- **Collect 配置使用**: 可在 collectConfig 中直接引用提取的文本文件

## 使用示例

### 在 SDK 调用中结合使用

```python
from sdk_client import MetaAgentSDK

sdk = MetaAgentSDK("http://127.0.0.1:3890")

# 先提取 PDF 文本
from skills.pdf_extract.extract_text import extract_text
extract_text("data/pdfs/2602.24289.pdf", "data/pdfs/2602.24289.txt")

# 然后调用 LLM 分析
result = sdk.run(
    goal=f"深度分析论文 2602.24289",
    workDir=str(project_dir),
    collectConfig={
        "sources": [
            {"type": "file", "query": "templates/paper_summary.md"},
            {"type": "file", "query": "data/pdfs/2602.24289.txt"},
            {"type": "skills", "query": "writing"},
        ],
        "maxTokens": 6000
    }
)
```

## 注意事项

1. 依赖 `pymupdf` (PyMuPDF) 库
2. 处理大型 PDF 时可能较慢，建议使用 `max_pages` 限制页数
3. 布局保留模式会增加处理时间且输出可能包含额外格式字符
4. 部分扫描版 PDF 需要 OCR 支持，此版本仅支持文本型 PDF
