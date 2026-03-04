#!/usr/bin/env python3
"""
extract_text.py - 从 PDF 提取文本

使用 PyMuPDF 从 PDF 文件中提取文本内容。

使用方法:
    python extract_text.py data/pdfs/paper.pdf
    python extract_text.py data/pdfs/paper.pdf -o output.txt
    python extract_text.py data/pdfs/paper.pdf -s 1 -e 10
    python extract_text.py data/pdfs/paper.pdf -m 5 --preserve-layout
"""

import argparse
import sys
from pathlib import Path
from typing import Optional, Tuple, List

try:
    import fitz  # PyMuPDF
except ImportError:
    print(
        "[ERROR] PyMuPDF not installed. Install with: pip install pymupdf",
        file=sys.stderr,
    )
    sys.exit(1)


def extract_text_from_pdf(
    pdf_path: str,
    start_page: int = 1,
    end_page: Optional[int] = None,
    max_pages: Optional[int] = None,
    preserve_layout: bool = False,
) -> str:
    """
    从 PDF 提取文本

    Args:
        pdf_path: PDF 文件路径
        start_page: 开始页码（1-indexed）
        end_page: 结束页码（1-indexed，None 表示最后一页）
        max_pages: 最大页数限制
        preserve_layout: 是否保留原始布局

    Returns:
        提取的文本内容
    """
    doc = fitz.open(pdf_path)

    # 计算实际结束页码
    if end_page is None:
        end_page = doc.page_count
    else:
        end_page = min(end_page, doc.page_count)

    # 应用最大页数限制
    if max_pages is not None:
        end_page = min(end_page, start_page - 1 + max_pages)

    # 确保页码有效
    start_page = max(1, start_page)
    end_page = max(start_page, end_page)

    text_parts: List[str] = []

    for page_num in range(start_page, end_page + 1):
        page = doc.load_page(page_num - 1)  # PyMuPDF 使用 0-indexed

        if preserve_layout:
            # 保留布局：按块提取，保持段落结构
            blocks = page.get_text("blocks")
            for block in blocks:
                # block[4] 是文本内容
                text_parts.append(block[4])
        else:
            # 默认模式：提取纯文本
            text = page.get_text()
            text_parts.append(text)

    doc.close()

    return "\n\n".join(text_parts)


def extract_text(
    pdf_path: str,
    output_path: Optional[str] = None,
    start_page: int = 1,
    end_page: Optional[int] = None,
    max_pages: Optional[int] = None,
    preserve_layout: bool = False,
) -> str:
    """
    从 PDF 提取文本，可选择保存到文件

    Args:
        pdf_path: PDF 文件路径
        output_path: 输出文件路径（None 表示输出到标准输出）
        start_page: 开始页码
        end_page: 结束页码
        max_pages: 最大页数限制
        preserve_layout: 是否保留原始布局

    Returns:
        提取的文本内容
    """
    pdf_file = Path(pdf_path)
    if not pdf_file.exists():
        raise FileNotFoundError(f"PDF file not found: {pdf_path}")

    text = extract_text_from_pdf(
        str(pdf_file),
        start_page=start_page,
        end_page=end_page,
        max_pages=max_pages,
        preserve_layout=preserve_layout,
    )

    if output_path:
        output_file = Path(output_path)
        output_file.parent.mkdir(parents=True, exist_ok=True)
        output_file.write_text(text, encoding="utf-8")
        print(f"[INFO] Extracted text saved to: {output_path}")
    else:
        print(text)

    return text


def main():
    parser = argparse.ArgumentParser(
        description="Extract text from PDF files using PyMuPDF",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("pdf_path", help="Path to the PDF file")
    parser.add_argument("-o", "--output", help="Output file path (default: stdout)")
    parser.add_argument(
        "-s", "--start-page", type=int, default=1, help="Start page number (default: 1)"
    )
    parser.add_argument(
        "-e", "--end-page", type=int, help="End page number (default: last page)"
    )
    parser.add_argument(
        "-m", "--max-pages", type=int, help="Maximum number of pages to extract"
    )
    parser.add_argument(
        "-p",
        "--preserve-layout",
        action="store_true",
        help="Preserve original layout formatting",
    )

    args = parser.parse_args()

    try:
        extract_text(
            args.pdf_path,
            output_path=args.output,
            start_page=args.start_page,
            end_page=args.end_page,
            max_pages=args.max_pages,
            preserve_layout=args.preserve_layout,
        )
        return 0
    except FileNotFoundError as e:
        print(f"[ERROR] {e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"[ERROR] Failed to extract text: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
