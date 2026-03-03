#!/usr/bin/env python3
"""
fetch_arxiv.py - 从 arXiv API 抓取论文

使用方法:
    python fetch_arxiv.py -c cs.CV,cs.LG -m 10 -o data/raw_papers.json
    python fetch_arxiv.py -c cs.CV -s 20260101 -e 20260301 -m 20 -o data/raw_papers.json
"""

import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional


def build_query(
    categories: List[str],
    search_query: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> str:
    """构建 arXiv 查询语句"""
    parts = []

    # 添加分类条件
    if categories:
        cat_parts = [f"cat:{cat}" for cat in categories]
        parts.append("(" + " OR ".join(cat_parts) + ")")

    # 添加关键词搜索
    if search_query:
        parts.append(f"all:{search_query}")

    # 添加日期范围
    if start_date:
        # 转换 YYYYMMDD -> YYMMDD
        parts.append(f"submittedDate:[{start_date[2:]} TO {end_date or '99999999'}]")

    return " AND ".join(parts) if parts else "all:*"


def fetch_papers(
    categories: List[str],
    max_results: int = 10,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    search_query: Optional[str] = None,
    sort_by: str = "submittedDate",
    sort_order: str = "descending",
) -> List[Dict[str, Any]]:
    """
    从 arXiv API 抓取论文

    Args:
        categories: arXiv 分类列表，如 ['cs.CV', 'cs.LG']
        max_results: 最大返回数量
        start_date: 开始日期 (YYYYMMDD)
        end_date: 结束日期 (YYYYMMDD)
        search_query: 搜索关键词
        sort_by: 排序字段
        sort_order: 排序方向

    Returns:
        论文列表
    """
    query = build_query(categories, search_query, start_date, end_date)

    # URL 编码
    query_encoded = urllib.parse.quote(query)

    url = (
        f"http://export.arxiv.org/api/query?"
        f"search_query={query_encoded}"
        f"&start=0"
        f"&max_results={max_results}"
        f"&sortBy={sort_by}"
        f"&sortOrder={sort_order}"
    )

    print(f"[INFO] Fetching from arXiv: {url[:200]}...")

    papers = []
    try:
        # 添加延迟以避免触发速率限制
        time.sleep(3)

        req = urllib.request.Request(url)
        req.add_header("User-Agent", "SurveyAgent/1.0")

        with urllib.request.urlopen(req, timeout=60) as response:
            data = response.read()

        root = ET.fromstring(data)

        # 处理 Atom 命名空间
        ns = {"atom": "http://www.w3.org/2005/Atom"}

        total_results = int(root.get("totalResults", 0))
        print(f"[INFO] Total results: {total_results}")

        for entry in root.findall("atom:entry", ns):
            # 提取基本信息
            arxiv_id_el = entry.find("atom:id", ns)
            arxiv_id = (
                arxiv_id_el.text.split("/")[-1]
                if arxiv_id_el is not None and arxiv_id_el.text
                else ""
            )

            title_el = entry.find("atom:title", ns)
            title = (
                title_el.text.strip().replace("\n", " ")
                if title_el is not None and title_el.text
                else ""
            )

            summary_el = entry.find("atom:summary", ns)
            summary = (
                summary_el.text.strip().replace("\n", " ")
                if summary_el is not None and summary_el.text
                else ""
            )

            # 提取作者
            authors = []
            for author in entry.findall("atom:author", ns):
                name_el = author.find("atom:name", ns)
                if name_el is not None and name_el.text:
                    authors.append(name_el.text)

            # 提取分类
            categories_list = []
            for cat in entry.findall("atom:category", ns):
                term = cat.get("term", "")
                if term:
                    categories_list.append(term)

            # 提取日期
            published_el = entry.find("atom:published", ns)
            published = (
                published_el.text[:10]
                if published_el is not None and published_el.text
                else ""
            )

            # 提取 PDF 链接
            pdf_url = None
            for link in entry.findall("atom:link", ns):
                if link.get("title") == "pdf":
                    pdf_url = link.get("href")
                    break

            papers.append(
                {
                    "arxiv_id": arxiv_id,
                    "title": title,
                    "summary": summary,
                    "authors": authors,
                    "categories": categories_list,
                    "published": published,
                    "pdf_url": pdf_url or f"https://arxiv.org/pdf/{arxiv_id}.pdf",
                }
            )

        print(f"[INFO] Fetched {len(papers)} papers")

    except Exception as e:
        print(f"[ERROR] Failed to fetch papers: {e}", file=sys.stderr)
        raise

    return papers


def save_papers(papers: List[Dict[str, Any]], output_path: Path):
    """保存论文列表到 JSON 文件"""
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(papers, f, ensure_ascii=False, indent=2)

    print(f"[INFO] Saved {len(papers)} papers to {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Fetch papers from arXiv API")
    parser.add_argument(
        "-c",
        "--categories",
        required=True,
        help="Comma-separated arXiv categories, e.g., cs.CV,cs.LG",
    )
    parser.add_argument(
        "-m",
        "--max-results",
        type=int,
        default=10,
        help="Maximum number of results (default: 10)",
    )
    parser.add_argument("-s", "--start-date", help="Start date (YYYYMMDD)")
    parser.add_argument("-e", "--end-date", help="End date (YYYYMMDD)")
    parser.add_argument("-q", "--query", help="Search query keywords")
    parser.add_argument("-o", "--output", required=True, help="Output JSON file path")

    args = parser.parse_args()

    categories = [c.strip() for c in args.categories.split(",")]

    papers = fetch_papers(
        categories=categories,
        max_results=args.max_results,
        start_date=args.start_date,
        end_date=args.end_date,
        search_query=args.query,
    )

    output_path = Path(args.output)
    save_papers(papers, output_path)

    return 0


if __name__ == "__main__":
    sys.exit(main())
