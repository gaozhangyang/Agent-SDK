#!/usr/bin/env python3
"""
extract_text.py - 从 PDF 文件提取文本

用法:
    python extract_text.py <pdf_path> [output_path]

    python extract_text.py data/pdfs/2501.12345.pdf
    python extract_text.py data/pdfs/2501.12345.pdf -o output.txt
    python extract_text.py data/pdfs/2501.12345.pdf --pages 1-3

依赖:
    pip install pymupdf
"""

import argparse
import os
import sys
from pathlib import Path
from typing import Optional, List, Tuple


def extract_text_from_pdf(
    pdf_path: str,
    pages: Optional[Tuple[int, int]] = None,
    max_pages: Optional[int] = None,
) -> str:
    """
    从 PDF 文件提取文本

    Args:
        pdf_path: PDF 文件路径
        pages: 页面范围 (start, end)，从1开始索引
        max_pages: 最大提取页数

    Returns:
        提取的文本内容
    """
    try:
        import fitz  # PyMuPDF
    except ImportError:
        raise ImportError("PyMuPDF is required. Install with: pip install pymupdf")

    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"PDF file not found: {pdf_path}")

    doc = fitz.open(pdf_path)
    total_pages = len(doc)

    # 确定提取的页面范围
    start_page = 0
    end_page = total_pages

    if pages:
        start_page = pages[0] - 1  # 转换为0索引
        end_page = pages[1]
    elif max_pages:
        end_page = min(max_pages, total_pages)

    # 提取文本
    text_parts = []

    for page_num in range(start_page, min(end_page, total_pages)):
        page = doc.load_page(page_num)
        text = page.get_text("text")

        if text.strip():
            text_parts.append(text)

        # 进度显示
        print(f"Extracted page {page_num + 1}/{total_pages}", file=sys.stderr, end="\r")

    print(f"\nExtracted {end_page - start_page} pages", file=sys.stderr)

    doc.close()

    return "\n\n".join(text_parts)


def extract_text_with_layout(pdf_path: str) -> str:
    """
    保留布局的文本提取

    Args:
        pdf_path: PDF 文件路径

    Returns:
        带布局信息的文本
    """
    try:
        import fitz
    except ImportError:
        raise ImportError("PyMuPDF is required. Install with: pip install pymupdf")

    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"PDF file not found: {pdf_path}")

    doc = fitz.open(pdf_path)
    text_parts = []

    for page_num in range(len(doc)):
        page = doc.load_page(page_num)

        # 获取文本块
        blocks = page.get_text("blocks")

        for block in blocks:
            # block 格式: (x0, y0, x1, y1, text, block_no, block_type)
            if len(block) >= 5:
                text = block[4].strip()
                if text:
                    text_parts.append(text)

    doc.close()

    return "\n\n".join(text_parts)


def main():
    parser = argparse.ArgumentParser(
        description="Extract text from PDF files",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s paper.pdf                    # 提取所有文本
  %(prog)s paper.pdf -o output.txt      # 保存到文件
  %(prog)s paper.pdf --pages 1-3        # 只提取前3页
  %(prog)s paper.pdf --max-pages 5      # 最多5页
  %(prog)s paper.pdf --layout           # 保留布局
        """,
    )

    parser.add_argument("pdf_path", type=str, help="Path to PDF file")
    parser.add_argument(
        "output",
        nargs="?",
        type=str,
        help="Output file path (optional, prints to stdout if not provided)",
    )
    parser.add_argument("--pages", "-p", type=str, help="Page range, e.g., 1-10")
    parser.add_argument(
        "--max-pages", "-m", type=int, help="Maximum number of pages to extract"
    )
    parser.add_argument(
        "--layout",
        "-l",
        action="store_true",
        help="Preserve layout (block-based extraction)",
    )

    args = parser.parse_args()

    # 解析页面范围
    page_range = None
    if args.pages:
        try:
            parts = args.pages.split("-")
            if len(parts) == 2:
                page_range = (int(parts[0]), int(parts[1]))
            else:
                raise ValueError("Invalid page range format")
        except ValueError:
            parser.error("Page range must be in format: start-end")

    try:
        if args.layout:
            text = extract_text_with_layout(args.pdf_path)
        else:
            text = extract_text_from_pdf(
                args.pdf_path, pages=page_range, max_pages=args.max_pages
            )

        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(text)
            print(f"Saved to {args.output}", file=sys.stderr)
        else:
            print(text)

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
