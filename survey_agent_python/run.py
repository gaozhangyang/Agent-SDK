#!/usr/bin/env python3
"""
run.py — Survey Agent Python 入口脚本

使用方法:
    python run.py                      # 执行一次完整的 Survey Workflow
    python run.py --max-results 20     # 指定最大抓取篇数
    python run.py --start-date 20260301 --end-date 20260303
    python run.py --research-query "video generation"

配置:
    所有运行时配置在 .agent/AGENT.md 的「运行时配置」块中定义。
    LLM apiKey 可通过环境变量 LLM_API_KEY 覆盖。
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

import requests

# 基础路径配置
BASE_DIR = Path(__file__).parent.absolute()
AGENT_MD = BASE_DIR / ".agent" / "AGENT.md"


def load_agent_config() -> Dict[str, Any]:
    """
    从 AGENT.md 中解析运行时配置。

    读取 AGENT.md 中的 JSON 配置块，提取运行时配置。
    """
    if not AGENT_MD.exists():
        raise FileNotFoundError(f"AGENT.md not found at {AGENT_MD}")

    content = AGENT_MD.read_text(encoding="utf-8")

    # 查找 JSON 配置块（从 "运行时配置" 后的第一个 ```json 开始）
    pattern = r"```json\s*\n(.*?)\n```"
    matches = re.findall(pattern, content, re.DOTALL)

    if not matches:
        raise ValueError("No JSON config block found in AGENT.md")

    # 找到运行时配置块（包含 llm, sdk_url, topics 等字段）
    for match in matches:
        try:
            config = json.loads(match)
            if "llm" in config and "sdk_url" in config:
                # 环境变量覆盖 apiKey
                if "LLM_API_KEY" in os.environ:
                    config["llm"]["apiKey"] = os.environ["LLM_API_KEY"]
                return config
        except json.JSONDecodeError:
            continue

    raise ValueError("Runtime config not found in AGENT.md")


def parse_args():
    """解析命令行参数"""
    parser = argparse.ArgumentParser(
        description="Survey Agent Python - 执行学术文献检索与知识管理 workflow"
    )
    parser.add_argument(
        "--max-results",
        type=int,
        default=None,
        help="本次最大抓取篇数（覆盖 AGENT.md 中的 fetch_max_papers）",
    )
    parser.add_argument(
        "--start-date",
        type=str,
        default=None,
        help="开始日期 (YYYYMMDD)",
    )
    parser.add_argument(
        "--end-date",
        type=str,
        default=None,
        help="结束日期 (YYYYMMDD)",
    )
    parser.add_argument(
        "--research-query",
        type=str,
        default=None,
        help="研究关键词（用于筛选）",
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="启用调试模式",
    )
    return parser.parse_args()


def build_goal(config: Dict[str, Any], args) -> str:
    """构建 Agent 任务目标"""
    topics = config.get("topics", [])
    topic_names = [t.get("name", "Unknown") for t in topics]

    goal = f"执行一次完整的 Survey Workflow。根据 AGENT.md 中的 topics 配置（{topic_names}），"
    goal += "从 arXiv 抓取最新论文，筛选高潜力论文并生成总结，写入知识库。"

    # 添加可选过滤参数
    if args.start_date:
        goal += f" 抓取时间范围：{args.start_date} 至 {args.end_date or '最新'}"
    if args.max_results:
        goal += f" 最多抓取 {args.max_results} 篇论文"
    if args.research_query:
        goal += f" 搜索关键词：{args.research_query}"

    return goal


def build_collect_sources(config: Dict[str, Any]) -> list:
    """构建 CollectConfig.sources"""
    sources = [
        # AGENT.md - 核心 workflow 定义
        {"type": "file", "query": ".agent/AGENT.md"},
        # Skills 文档
        {"type": "skills", "query": "arxiv_api"},
        {"type": "skills", "query": "screening"},
        {"type": "skills", "query": "writing"},
        {"type": "skills", "query": "pdf_extract"},
    ]

    # 动态添加 knowledge_base 中各 topic 的 meta.json
    kb_dir = BASE_DIR / "knowledge_base"
    if kb_dir.exists():
        for kb_path in kb_dir.glob("*/meta.json"):
            topic_name = kb_path.parent.name
            sources.append(
                {"type": "file", "query": f"knowledge_base/{topic_name}/meta.json"}
            )

    # 添加模板文件（如果存在）
    template_path = BASE_DIR / "templates" / "paper_summary.md"
    if template_path.exists():
        sources.append({"type": "file", "query": "templates/paper_summary.md"})

    return sources


def run_agent(
    goal: str,
    config: Dict[str, Any],
    args,
) -> Dict[str, Any]:
    """
    调用 meta-agent-core SDK 执行 Agent 任务。

    这是一个最小实现的 SDK 调用，基于 requests.post。
    """
    sdk_url = config.get("sdk_url", "http://127.0.0.1:3890")
    llm_config = config.get("llm", {})

    # 构造请求 payload
    payload = {
        "goal": goal,
        "workDir": str(BASE_DIR),
        "collectConfig": {
            "sources": build_collect_sources(config),
            "maxTokens": 8000,
        },
        "llm": llm_config,
        "thresholds": {
            "maxIterations": 100,
            "maxNoProgress": 10,
        },
        "debug": args.debug or config.get("debug", False),
    }

    # 添加可选参数覆盖
    if args.max_results:
        # 将参数传递给 Agent，让它根据配置调整抓取数量
        pass  # 通过 goal 传递

    print(f"\n{'=' * 60}")
    print(f"Survey Agent Workflow 启动")
    print(f"{'=' * 60}")
    print(f"SDK URL: {sdk_url}")
    print(f"Goal: {goal[:200]}...")
    print(f"LLM: {llm_config.get('model')} @ {llm_config.get('baseUrl')}")
    print(f"Debug: {payload['debug']}")
    print(f"{'=' * 60}\n")

    try:
        response = requests.post(
            f"{sdk_url}/run",
            json=payload,
            timeout=1800,  # 30 分钟超时
        )
        response.raise_for_status()
        result = response.json()
        return result
    except requests.exceptions.Timeout:
        return {"status": "error", "reason": "Request timeout after 30 minutes"}
    except requests.exceptions.RequestException as e:
        return {"status": "error", "reason": str(e)}


def main():
    """主入口函数"""
    # 解析命令行参数
    args = parse_args()

    # 加载配置
    print("Loading config from AGENT.md...")
    config = load_agent_config()

    # 命令行参数覆盖配置
    if args.max_results:
        config["fetch_max_papers"] = args.max_results
    if args.debug:
        config["debug"] = True

    # 构建 goal
    goal = build_goal(config, args)

    # 确保必要目录存在
    (BASE_DIR / "data").mkdir(parents=True, exist_ok=True)
    (BASE_DIR / "data" / "pdfs").mkdir(parents=True, exist_ok=True)
    (BASE_DIR / "knowledge_base").mkdir(parents=True, exist_ok=True)

    # 执行 Agent
    result = run_agent(goal, config, args)

    # 输出结果
    print(f"\n{'=' * 60}")
    print("Survey Agent Workflow 完成")
    print(f"{'=' * 60}")
    print(f"Status: {result.get('status', 'unknown')}")

    if result.get("status") in ("completed", "escalated", "budget_exceeded"):
        print("Agent execution completed successfully.")
    elif result.get("status") == "error":
        print(f"Error: {result.get('reason', 'Unknown error')}")
        sys.exit(1)
    else:
        print(f"Reason: {result.get('reason', 'Unknown')}")
        sys.exit(1)

    # 记录运行日志
    today = datetime.now().strftime("%Y-%m-%d")
    log_entry = {
        "date": today,
        "status": result.get("status"),
        "goal": goal,
        "timestamp": datetime.now().isoformat(),
    }
    log_file = BASE_DIR / "data" / "run_log.jsonl"
    with open(log_file, "a", encoding="utf-8") as f:
        f.write(json.dumps(log_entry, ensure_ascii=False) + "\n")

    print(f"\nLog written to: {log_file}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
