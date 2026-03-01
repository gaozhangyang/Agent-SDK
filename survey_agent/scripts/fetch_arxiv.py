#!/usr/bin/env python3
"""
fetch_arxiv.py - 从 arXiv API 获取论文摘要

用法:
    python fetch_arxiv.py [--categories CS.CL,CS.AI] [--max-results 100] [--output data/raw_papers_2025-01-01.json]

依赖:
    pip install feedparser requests
"""

import argparse
import json
import sys
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timedelta
from typing import List, Dict, Optional
import time


ARXIV_API_URL = "http://export.arxiv.org/api/query"


def build_query(
    categories: List[str],
    max_results: int = 100,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> str:
    """构建 arXiv API 查询语句"""
    # 按分类搜索
    cat_query = " OR ".join([f"cat:{cat}" for cat in categories])

    # 添加日期过滤
    date_query = ""
    if start_date:
        date_query += f" AND submittedDate:[{start_date} TO {end_date or datetime.now().strftime('%Y%m%d')}]"

    return f"({cat_query}){date_query}"


def fetch_papers(
    categories: List[str],
    max_results: int = 100,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    timeout: int = 30,
) -> List[Dict]:
    """
    从 arXiv 获取论文

    Args:
        categories: arXiv 分类列表，如 ['cs.CL', 'cs.AI']
        max_results: 最大返回数量
        start_date: 开始日期 (YYYYMMDD)
        end_date: 结束日期 (YYYYMMDD)
        timeout: 超时时间(秒)

    Returns:
        论文列表
    """
    query = build_query(categories, max_results, start_date, end_date)

    params = {
        "search_query": query,
        "start": 0,
        "max_results": max_results,
        "sortBy": "submittedDate",
        "sortOrder": "descending",
    }

    url = f"{ARXIV_API_URL}?{urllib.parse.urlencode(params)}"
    print(f"Fetching from: {url}", file=sys.stderr)

    papers = []
    retries = 3

    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "SurveyAgent/1.0 (academic research)"}
            )

            with urllib.request.urlopen(req, timeout=timeout) as response:
                import feedparser

                feed = feedparser.parse(response)

                for entry in feed.entries:
                    # 提取 arXiv ID (移除版本号)
                    arxiv_id = entry.id.split("/")[-1]
                    if "v" in arxiv_id:
                        arxiv_id = arxiv_id.rsplit("v", 1)[0]

                    # 提取作者
                    authors = [author.name for author in entry.authors]

                    # 提取分类
                    categories_list = (
                        [cat.term for cat in entry.tags]
                        if hasattr(entry, "tags")
                        else []
                    )

                    # 提取发布日期
                    published = (
                        entry.get("published", "")[:10]
                        if entry.get("published")
                        else ""
                    )

                    paper = {
                        "arxiv_id": arxiv_id,
                        "title": entry.title.strip().replace("\n", " "),
                        "abstract": entry.summary.strip().replace("\n", " "),
                        "authors": authors,
                        "submitted": published,
                        "categories": categories_list,
                        "pdf_url": f"https://arxiv.org/pdf/{arxiv_id}",
                        "abs_url": f"https://arxiv.org/abs/{arxiv_id}",
                    }
                    papers.append(paper)

                print(f"Fetched {len(papers)} papers", file=sys.stderr)
                return papers

        except urllib.error.URLError as e:
            print(f"Attempt {attempt + 1} failed: {e}", file=sys.stderr)
            if attempt < retries - 1:
                wait_time = (attempt + 1) * 5
                print(f"Waiting {wait_time}s before retry...", file=sys.stderr)
                time.sleep(wait_time)
            else:
                raise
        except Exception as e:
            print(f"Error parsing feed: {e}", file=sys.stderr)
            raise

    return papers


def fetch_today_papers(categories: List[str], max_results: int = 100) -> List[Dict]:
    """获取今天的论文"""
    today = datetime.now().strftime("%Y%m%d")
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y%m%d")
    return fetch_papers(categories, max_results, yesterday, today)


def main():
    parser = argparse.ArgumentParser(description="Fetch papers from arXiv")
    parser.add_argument(
        "--categories",
        "-c",
        type=str,
        default="cs.CL,cs.AI,cs.CV,cs.LG",
        help="Comma-separated arXiv categories",
    )
    parser.add_argument(
        "--max-results", "-m", type=int, default=100, help="Maximum number of results"
    )
    parser.add_argument("--output", "-o", type=str, help="Output JSON file path")
    parser.add_argument("--start-date", "-s", type=str, help="Start date (YYYYMMDD)")
    parser.add_argument("--end-date", "-e", type=str, help="End date (YYYYMMDD)")

    args = parser.parse_args()

    categories = args.categories.split(",")

    papers = fetch_papers(
        categories=categories,
        max_results=args.max_results,
        start_date=args.start_date,
        end_date=args.end_date,
    )

    output = json.dumps(papers, ensure_ascii=False, indent=2)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(output)
        print(f"Saved {len(papers)} papers to {args.output}", file=sys.stderr)
    else:
        print(output)


if __name__ == "__main__":
    main()
