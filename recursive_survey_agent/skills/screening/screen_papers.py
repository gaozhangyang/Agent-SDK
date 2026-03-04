#!/usr/bin/env python3
"""
screen_papers.py - 基于关键词和知识库筛选论文

使用方法:
    python screen_papers.py data/raw_papers.json data/selected_papers.json
    python screen_papers.py data/raw_papers.json data/selected_papers.json --threshold 0.7
    python screen_papers.py data/raw_papers.json data/selected_papers.json --topics knowledge_base
"""

import argparse
import json
import re
import sys
from pathlib import Path
from typing import List, Dict, Any, Optional


def load_config(config_path: Path) -> Dict[str, Any]:
    """加载用户配置"""
    if not config_path.exists():
        return {"topics": []}

    with open(config_path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_blacklist(blacklist_path: Path) -> List[str]:
    """加载黑名单"""
    if not blacklist_path.exists():
        return []

    try:
        data = json.loads(blacklist_path.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data
        return data.get("blacklist", [])
    except:
        return []


def load_topic_keywords(kb_dir: Path) -> Dict[str, Dict[str, Any]]:
    """从知识库加载主题和关键词"""
    topics = {}

    if not kb_dir.exists():
        return topics

    for topic_dir in kb_dir.iterdir():
        if not topic_dir.is_dir():
            continue

        meta_file = topic_dir / "meta.json"
        if not meta_file.exists():
            continue

        try:
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
            topics[topic_dir.name] = {
                "name": meta.get("name", topic_dir.name),
                "keywords": meta.get("keywords", []),
                "arxiv_categories": meta.get("arxiv_categories", []),
                "min_score": meta.get("min_relevance_score", 0.6),
            }
        except Exception as e:
            print(f"[WARN] Failed to load meta.json from {topic_dir}: {e}")

    return topics


def calculate_keyword_score(
    text: str,
    keywords: List[str],
    title_weight: float = 1.0,
    abstract_weight: float = 0.8,
) -> float:
    """计算关键词匹配得分"""
    if not keywords:
        return 0.0

    text_lower = text.lower()
    matched = 0

    for keyword in keywords:
        keyword_lower = keyword.lower()

        # 检查是否在标题中
        if keyword_lower in text_lower:
            matched += title_weight
            continue

        # 检查是否在摘要中
        # 简单的模糊匹配
        keyword_parts = keyword_lower.split()
        if any(part in text_lower for part in keyword_parts):
            matched += abstract_weight

    return matched / len(keywords)


def assign_topic(
    paper: Dict[str, Any], topics: Dict[str, Dict[str, Any]]
) -> Optional[str]:
    """为论文分配主题"""
    paper_categories = set(paper.get("categories", []))

    best_topic = None
    best_score = 0.0

    for topic_id, topic_info in topics.items():
        # 检查分类是否匹配
        topic_cats = set(topic_info.get("arxiv_categories", []))
        if not topic_cats.intersection(paper_categories):
            continue

        # 计算关键词匹配得分
        title = paper.get("title", "")
        summary = paper.get("summary", "")

        score = calculate_keyword_score(
            title + " " + summary, topic_info.get("keywords", [])
        )

        if score > best_score:
            best_score = score
            best_topic = topic_id

    return best_topic


def screen_papers(
    raw_papers: List[Dict[str, Any]],
    config: Dict[str, Any],
    blacklist: List[str],
    kb_dir: Optional[Path] = None,
    threshold_override: Optional[float] = None,
) -> List[Dict[str, Any]]:
    """
    筛选论文

    Args:
        raw_papers: 原始论文列表
        config: 用户配置
        blacklist: 黑名单
        kb_dir: 知识库目录
        threshold_override: 覆盖默认阈值

    Returns:
        筛选后的论文列表
    """
    selected = []

    # 获取配置中的主题
    config_topics = config.get("topics", [])

    # 如果有知识库，加载知识库中的主题
    kb_topics = {}
    if kb_dir:
        kb_topics = load_topic_keywords(kb_dir)

    # 合并主题配置
    all_topics = {}

    # 从配置中添加主题
    for topic in config_topics:
        topic_name = topic.get("name", "")
        if topic_name:
            min_score = (
                threshold_override
                if threshold_override
                else topic.get("min_relevance_score", 0.6)
            )
            all_topics[topic_name] = {
                "name": topic.get("name", topic_name),
                "keywords": topic.get("keywords", []),
                "arxiv_categories": topic.get("arxiv_categories", []),
                "min_score": min_score,
            }

    # 从知识库添加主题（覆盖配置）
    for topic_id, topic_info in kb_topics.items():
        min_score = (
            threshold_override
            if threshold_override
            else topic_info.get("min_score", 0.6)
        )
        kb_topics[topic_id]["min_score"] = min_score

    all_topics.update(kb_topics)

    for paper in raw_papers:
        arxiv_id = paper.get("arxiv_id", "")

        # 检查黑名单
        if arxiv_id in blacklist:
            print(f"[SKIP] {arxiv_id} is in blacklist")
            continue

        # 分配主题
        target_topic = assign_topic(paper, all_topics)

        if not target_topic:
            print(f"[SKIP] {arxiv_id}: no matching topic")
            continue

        topic_info = all_topics[target_topic]

        # 计算相关度得分
        title = paper.get("title", "")
        summary = paper.get("summary", "")

        relevance_score = calculate_keyword_score(
            title + " " + summary, topic_info.get("keywords", [])
        )

        # 检查是否满足最低分数要求
        min_score = topic_info.get("min_score", 0.6)

        if relevance_score < min_score:
            print(f"[SKIP] {arxiv_id}: score {relevance_score:.2f} < {min_score}")
            continue

        # 添加到筛选结果
        paper["target_topic"] = target_topic
        paper["relevance_score"] = round(relevance_score, 2)
        selected.append(paper)

        print(f"[SELECT] {arxiv_id}: {target_topic} (score: {relevance_score:.2f})")

    # 按相关度得分排序
    selected.sort(key=lambda x: x.get("relevance_score", 0), reverse=True)

    return selected


def main():
    parser = argparse.ArgumentParser(description="Screen papers based on keywords")
    parser.add_argument("input", help="Input JSON file (raw papers)")
    parser.add_argument("output", help="Output JSON file (selected papers)")
    parser.add_argument(
        "--config", default="config/user_config.json", help="User config file"
    )
    parser.add_argument(
        "--blacklist", default="data/blacklist.json", help="Blacklist file"
    )
    parser.add_argument(
        "--topics", default="knowledge_base", help="Knowledge base directory"
    )
    parser.add_argument(
        "--threshold", type=float, help="Override minimum relevance score"
    )

    args = parser.parse_args()

    # 加载数据
    input_path = Path(args.input)
    if not input_path.exists():
        print(f"[ERROR] Input file not found: {input_path}", file=sys.stderr)
        return 1

    with open(input_path, "r", encoding="utf-8") as f:
        raw_papers = json.load(f)

    # 加载配置
    config_path = Path(args.config)
    config = load_config(config_path)

    # 加载黑名单
    blacklist_path = Path(args.blacklist)
    blacklist = load_blacklist(blacklist_path)

    # 加载知识库主题
    kb_dir = Path(args.topics)

    # 筛选论文
    selected = screen_papers(raw_papers, config, blacklist, kb_dir, args.threshold)

    # 保存结果
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    result = {"count": len(selected), "papers": selected}

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"[INFO] Selected {len(selected)} papers, saved to {output_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
