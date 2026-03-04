#!/usr/bin/env python3
"""
download_pdf.py - 从 arXiv 下载 PDF 论文

使用 urllib 从 arXiv 下载 PDF 文件。

使用方法:
    python download_pdf.py 2602.12345
    python download_pdf.py 2602.12345 -o data/pdfs/
    python download_pdf.py --input data/selected_papers.json -o data/pdfs/

依赖:
    Python 标准库 (urllib)
"""

import argparse
import json
import os
import sys
import time
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional, Any


def download_pdf(
    arxiv_id: str,
    output_dir: Path,
    overwrite: bool = False,
) -> Optional[Path]:
    """
    下载单个 PDF 文件

    Args:
        arxiv_id: arXiv 论文 ID (如 2602.12345)
        output_dir: 输出目录
        overwrite: 是否覆盖已存在的文件

    Returns:
        下载的文件路径，失败返回 None
    """
    # 清理 arXiv ID (移除版本号)
    clean_id = arxiv_id.split("v")[0]

    # 构建输出路径
    output_path = output_dir / f"{clean_id}.pdf"

    # 检查文件是否存在
    if output_path.exists() and not overwrite:
        print(f"[SKIP] {clean_id}.pdf already exists")
        return output_path

    # 构建 PDF URL
    pdf_url = f"https://arxiv.org/pdf/{arxiv_id}.pdf"

    print(f"[DOWNLOAD] {pdf_url}")

    try:
        # 添加延迟以避免触发速率限制
        time.sleep(3)

        # 创建请求
        req = urllib.request.Request(pdf_url, headers={"User-Agent": "SurveyAgent/1.0"})

        # 下载文件
        with urllib.request.urlopen(req, timeout=120) as response:
            content = response.read()

            # 确保目录存在
            output_dir.mkdir(parents=True, exist_ok=True)

            # 写入文件
            with open(output_path, "wb") as f:
                f.write(content)

            print(f"[SUCCESS] Downloaded to: {output_path}")
            return output_path

    except urllib.error.HTTPError as e:
        print(f"[ERROR] HTTP Error {e.code}: {e.reason}", file=sys.stderr)
    except urllib.error.URLError as e:
        print(f"[ERROR] URL Error: {e.reason}", file=sys.stderr)
    except Exception as e:
        print(f"[ERROR] Failed to download {arxiv_id}: {e}", file=sys.stderr)

    return None


def download_papers_from_json(
    json_path: Path,
    output_dir: Path,
    overwrite: bool = False,
) -> List[Dict[str, Any]]:
    """
    从 JSON 文件下载多篇论文的 PDF

    Args:
        json_path: 包含论文信息的 JSON 文件路径
        output_dir: 输出目录
        overwrite: 是否覆盖已存在的文件

    Returns:
        下载结果列表
    """
    if not json_path.exists():
        print(f"[ERROR] JSON file not found: {json_path}", file=sys.stderr)
        return []

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # 处理不同的 JSON 格式
    papers = []
    if isinstance(data, dict):
        if "papers" in data:
            papers = data["papers"]
        else:
            papers = [data]
    elif isinstance(data, list):
        papers = data

    results = []
    for paper in papers:
        arxiv_id = paper.get("arxiv_id", "")
        if not arxiv_id:
            continue

        result = {
            "arxiv_id": arxiv_id,
            "title": paper.get("title", ""),
            "status": "pending",
            "path": None,
        }

        output_path = download_pdf(arxiv_id, output_dir, overwrite)
        if output_path:
            result["status"] = "success"
            result["path"] = str(output_path)
        else:
            result["status"] = "failed"

        results.append(result)

    return results


def main():
    parser = argparse.ArgumentParser(
        description="Download PDF papers from arXiv",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )

    # 互斥组：单个论文 ID 或 JSON 文件
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "arxiv_id",
        nargs="?",
        help="arXiv paper ID (e.g., 2602.12345)",
    )
    group.add_argument(
        "-i",
        "--input",
        help="JSON file containing paper information",
    )

    parser.add_argument(
        "-o",
        "--output",
        default="data/pdfs",
        help="Output directory (default: data/pdfs)",
    )
    parser.add_argument(
        "-f",
        "--force",
        action="store_true",
        help="Overwrite existing files",
    )

    args = parser.parse_args()

    output_dir = Path(args.output)

    # 确保输出目录存在
    output_dir.mkdir(parents=True, exist_ok=True)

    if args.arxiv_id:
        # 下载单个 PDF
        result = download_pdf(args.arxiv_id, output_dir, args.force)
        if result:
            return 0
        else:
            return 1

    elif args.input:
        # 从 JSON 文件批量下载
        results = download_papers_from_json(
            Path(args.input),
            output_dir,
            args.force,
        )

        # 输出摘要
        success = sum(1 for r in results if r["status"] == "success")
        failed = sum(1 for r in results if r["status"] == "failed")

        print(f"\n[SUMMARY] Downloaded: {success}, Failed: {failed}")

        # 保存结果
        result_path = output_dir / "download_results.json"
        with open(result_path, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)

        print(f"[INFO] Results saved to: {result_path}")

        return 0


if __name__ == "__main__":
    sys.exit(main())
