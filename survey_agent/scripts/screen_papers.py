#!/usr/bin/env python3
"""
screen_papers.py - 根据评分阈值筛选论文

用法:
    python screen_papers.py <raw_papers.json> <output.json> [--threshold THRESHOLD] [--topics TOPICS_DIR]

依赖:
    pip install openai
"""

import argparse
import json
import os
import sys
from pathlib import Path


def screen_papers(raw_file, output_file, threshold=7.0, topics_dir=None, query=None):
    """
    筛选论文
    
    Args:
        raw_file: 原始论文 JSON 文件路径
        output_file: 输出筛选后的论文 JSON 文件路径
        threshold: 相关性评分阈值
        topics_dir: 知识板块目录路径
    """
    # 读取原始论文
    if not os.path.exists(raw_file):
        raise FileNotFoundError(f"Raw papers file not found: {raw_file}")
    
    with open(raw_file, 'r', encoding='utf-8') as f:
        papers = json.load(f)
    
    print(f"Loaded {len(papers)} papers from {raw_file}")
    
    # 读取知识板块配置
    topics = []
    if topics_dir and os.path.exists(topics_dir):
        for meta_file in Path(topics_dir).glob("*/meta.json"):
            try:
                meta = json.loads(meta_file.read_text(encoding='utf-8'))
                topics.append({
                    'id': meta_file.parent.name,
                    'name': meta.get('name', meta_file.parent.name),
                    'keywords': meta.get('keywords', []),
                    'categories': meta.get('arxiv_categories', []),
                })
                print(f"Loaded topic: {meta_file.parent.name}")
            except Exception as e:
                print(f"Warning: Failed to load {meta_file}: {e}")
    
    # 简单的关键词 / 检索意图匹配评分
    # 在实际生产环境中，这里应该调用 LLM 进行更准确的评分
    selected = []
    
    for paper in papers:
        # 计算相关性评分
        score = 0.0
        title = paper.get('title', '').lower()
        abstract = paper.get('abstract', '').lower()
        categories = paper.get('categories', [])
        
        # 根据类别匹配打分
        for topic in topics:
            for cat in topic.get('categories', []):
                if cat in categories:
                    score += 2.0
        
        # 根据关键词匹配打分
        for topic in topics:
            for keyword in topic.get('keywords', []):
                keyword_lower = keyword.lower()
                if keyword_lower in title:
                    score += 3.0
                if keyword_lower in abstract:
                    score += 1.0
        
        # 根据自定义检索描述打分（如果提供）
        if query:
            q = query.lower()
            # 拆分为简单 token（空格分割），便于英文/拼音等检索
            tokens = [tok for tok in q.split() if tok]
            if not tokens:
                tokens = [q]
            for tok in tokens:
                if tok in title:
                    score += 2.0
                if tok in abstract:
                    score += 1.0

        # 根据提交日期打分（越新分数越高）
        submitted = paper.get('submitted', '')
        if submitted:
            # 最近的论文加分
            score += 1.0
        
        # 分配到最匹配的主题
        best_topic = None
        best_topic_score = 0
        for topic in topics:
            topic_score = 0
            for cat in topic.get('categories', []):
                if cat in categories:
                    topic_score += 2
            for keyword in topic.get('keywords', []):
                keyword_lower = keyword.lower()
                if keyword_lower in title:
                    topic_score += 3
                if keyword_lower in abstract:
                    topic_score += 1
            if topic_score > best_topic_score:
                best_topic_score = topic_score
                best_topic = topic['id']
        
        # 如果分数超过阈值，选择这篇论文
        if score >= threshold:
            paper['relevance_score'] = round(score, 1)
            paper['target_topic'] = best_topic if best_topic else 'NLP_and_LLM'
            selected.append(paper)
            print(f"Selected: {paper.get('arxiv_id')} (score: {score:.1f}, topic: {paper['target_topic']})")
    
    print(f"\nTotal selected: {len(selected)} / {len(papers)} papers")
    
    # 保存筛选结果
    os.makedirs(os.path.dirname(output_file) if os.path.dirname(output_file) else '.', exist_ok=True)
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(selected, f, ensure_ascii=False, indent=2)
    
    print(f"Saved to {output_file}")
    return selected


def main():
    parser = argparse.ArgumentParser(description="Screen papers by relevance")
    parser.add_argument("input", type=str, help="Input raw papers JSON file")
    parser.add_argument("output", type=str, help="Output selected papers JSON file")
    parser.add_argument("--threshold", "-t", type=float, default=7.0, 
                        help="Relevance score threshold (default: 7.0)")
    parser.add_argument("--topics", "-k", type=str, 
                        default="knowledge_base",
                        help="Topics directory (default: knowledge_base)")
    parser.add_argument("--query", "-q", type=str, default=None,
                        help="Free-text research query used for extra relevance scoring")
    
    args = parser.parse_args()
    
    try:
        screen_papers(args.input, args.output, args.threshold, args.topics, args.query)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
