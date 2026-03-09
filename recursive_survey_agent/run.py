#!/usr/bin/env python3
"""
run.py — Recursive Survey Agent 入口脚本

使用 recursive-meta-agent 作为后端执行 Survey Workflow。
通过直接导入调用，方便调试。

使用方法:
    python run.py                      # 执行一次完整的 Survey Workflow
    python run.py --max-results 20     # 指定最大抓取篇数
    python run.py --start-date 20260301 --end-date 20260303
    python run.py --research-query "video generation"

配置:
    所有运行时配置在 .agent/AGENT.md 的「运行时配置」块中定义。
    LLM 配置通过环境变量设置:
    - LLM_API_KEY: API 密钥 (必需)
    - LLM_MODEL: 模型名称 (默认: MiniMax-M2.5)
    - LLM_BASE_URL: API 地址 (默认: http://35.220.164.252:3888/v1)
"""

import argparse
import json
import os
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

# 基础路径配置
BASE_DIR = Path(__file__).parent.absolute()
AGENT_MD = BASE_DIR / ".agent" / "AGENT.md"
RECURSIVE_META_AGENT_DIR = BASE_DIR.parent / "recursive-meta-agent"

# 将 recursive-meta-agent 的 src 目录添加到 Python 路径
if RECURSIVE_META_AGENT_DIR.exists():
    sys.path.insert(0, str(RECURSIVE_META_AGENT_DIR / "src"))
    from agent import run_agent as meta_agent_run
else:
    meta_agent_run = None


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

    # 找到运行时配置块
    for match in matches:
        try:
            config = json.loads(match)
            if "llm" in config:
                # 环境变量覆盖配置
                if "LLM_API_KEY" in os.environ:
                    config["llm"]["apiKey"] = os.environ["LLM_API_KEY"]
                if "LLM_MODEL" in os.environ:
                    config["llm"]["model"] = os.environ["LLM_MODEL"]
                if "LLM_BASE_URL" in os.environ:
                    config["llm"]["baseUrl"] = os.environ["LLM_BASE_URL"]
                return config
        except json.JSONDecodeError:
            continue

    raise ValueError("Runtime config not found in AGENT.md")


def parse_args(argv=None):
    """解析命令行参数

    Args:
        argv: 命令行参数列表，默认为 None (使用 sys.argv)
    """
    parser = argparse.ArgumentParser(
        description="Recursive Survey Agent - 使用 recursive-meta-agent 执行学术文献检索"
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
    return parser.parse_args(argv)


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


def setup_goal_directory(goal: str, config: Dict[str, Any], args) -> Path:
    """
    设置 recursive-meta-agent 所需的目录结构。

    目录结构:
    {workDir}/goals/{goal_id}/
        ├── goal.md           # 任务描述
        ├── permissions.json  # 权限配置
    """
    # 创建 goals 目录
    goals_dir = BASE_DIR / "goals"
    goals_dir.mkdir(parents=True, exist_ok=True)

    # 生成唯一的目标目录名
    goal_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    goal_dir = goals_dir / f"survey_{goal_id}"
    goal_dir.mkdir(parents=True, exist_ok=True)

    # 写入 goal.md
    goal_path = goal_dir / "goal.md"
    goal_path.write_text(goal, encoding="utf-8")

    # 写入 permissions.json（路径相对于 goal_dir = goals/survey_xxx，需用 ../../ 回到项目根）
    permissions = {
        "read": [".", "../../.agent/", "../../skills/"],
        "write": [".", "../../data/", "../../knowledge_base/"],
        "bash": {
            "network": True,
            "delete": False,
        },
        "max_depth": config.get("max_depth", 4),
        "max_output_length": config.get("maxOutputLength", 102400),
        "context_budget": {
            "total": config.get("context_budget_total", 200000),
            "reservedOutput": config.get("context_budget_reserved", 4000),
        },
    }

    permissions_path = goal_dir / "permissions.json"
    with open(permissions_path, "w", encoding="utf-8") as f:
        json.dump(permissions, f, indent=2, ensure_ascii=False)

    # 复制或创建 context.md (收集的上下文信息)
    context_content = build_context_content(config, args)
    context_path = goal_dir / "context.md"
    context_path.write_text(context_content, encoding="utf-8")

    return goal_dir


def build_context_content(config: Dict[str, Any], args) -> str:
    """构建初始上下文内容，预加载所有关键文档，让 LLM 无需探索即可直接使用 skills"""

    SKILLS_DIR = BASE_DIR / "skills"

    def _read_file(path: Path) -> str:
        try:
            return path.read_text(encoding="utf-8")
        except Exception as e:
            return f"[Failed to read {path}: {e}]"

    content = "# Survey Workflow Context\n\n"
    content += f"> 工作目录: {BASE_DIR}\n\n"

    # -----------------------------------------------------------------------
    # 1. AGENT.md —— Workflow 规范 + 运行时配置（最重要，放最前）
    # -----------------------------------------------------------------------
    agent_md_path = BASE_DIR / ".agent" / "AGENT.md"
    content += "## AGENT.md (Workflow 规范 & 运行时配置)\n\n"
    content += f"> 路径: {agent_md_path}\n\n"
    content += _read_file(agent_md_path)
    content += "\n\n"

    # -----------------------------------------------------------------------
    # 2. README —— 项目整体说明
    # -----------------------------------------------------------------------
    readme_path = BASE_DIR / "README.md"
    content += "## README (项目说明)\n\n"
    content += f"> 路径: {readme_path}\n\n"
    content += _read_file(readme_path)
    content += "\n\n"

    # -----------------------------------------------------------------------
    # 3. Skills 文档 —— 完整内联，让 LLM 直接知道每个 skill 的调用方式
    # -----------------------------------------------------------------------
    content += "## Skills 使用手册\n\n"
    content += (
        "> 以下每个 skill 的 SKILL.md 已内联。生成 script.py 时直接按照示例调用，"
        "无需再读取文件探索。所有路径均为绝对路径。\n\n"
    )

    skill_names = ["arxiv_api", "screening", "writing", "pdf_extract"]
    for skill_name in skill_names:
        skill_md_path = SKILLS_DIR / skill_name / "SKILL.md"
        content += f"### Skill: {skill_name}\n\n"
        content += f"> SKILL.md 路径: {skill_md_path}\n\n"
        content += _read_file(skill_md_path)
        content += "\n\n"

        # 同时列出 skill 目录下其他 .py 文件的绝对路径，方便 script.py 直接调用
        skill_dir = SKILLS_DIR / skill_name
        py_files = sorted(skill_dir.glob("*.py")) if skill_dir.exists() else []
        if py_files:
            content += f"**{skill_name} 可执行脚本（绝对路径）：**\n\n"
            for py_file in py_files:
                content += f"- `{py_file.resolve()}`\n"
            content += "\n"

    # -----------------------------------------------------------------------
    # 4. 工作目录结构 snapshot
    # -----------------------------------------------------------------------
    content += "## 工作目录结构\n\n"
    content += f"```\n{BASE_DIR}\n"
    try:
        for root, dirs, files in os.walk(BASE_DIR):
            # 跳过运行时生成目录，避免 context 膨胀
            dirs[:] = [
                d for d in sorted(dirs)
                if d not in {"goals", "__pycache__", ".git", "pdfs"}
            ]
            level = Path(root).relative_to(BASE_DIR).parts
            indent = "    " * len(level)
            folder_name = os.path.basename(root)
            if root != str(BASE_DIR):
                content += f"{indent}{folder_name}/\n"
            sub_indent = "    " * (len(level) + 1)
            for f in sorted(files):
                content += f"{sub_indent}{f}\n"
    except Exception as e:
        content += f"[Failed to walk directory: {e}]\n"
    content += "```\n\n"

    # -----------------------------------------------------------------------
    # 5. 运行时参数 & fetch 配置
    # -----------------------------------------------------------------------
    content += "## 运行时配置\n\n"

    # Topics
    topics = config.get("topics", [])
    if topics:
        content += "### Topics\n\n"
        content += "```json\n"
        content += json.dumps(topics, indent=2, ensure_ascii=False)
        content += "\n```\n\n"

    # Fetch 参数
    content += "### Fetch 参数\n\n"
    content += f"- fetch_max_papers: {config.get('fetch_max_papers', 10)}\n"
    content += f"- pdf_download_dir: {(BASE_DIR / config.get('pdf_download_dir', 'data/pdfs')).resolve()}\n"
    content += f"- screening_threshold: {config.get('screening_threshold', 0.6)}\n\n"

    # 命令行覆盖参数
    overrides = {
        "max_results": args.max_results,
        "start_date": args.start_date,
        "end_date": getattr(args, "end_date", None),
        "research_query": args.research_query,
    }
    active_overrides = {k: v for k, v in overrides.items() if v}
    if active_overrides:
        content += "### 命令行覆盖参数\n\n"
        for k, v in active_overrides.items():
            content += f"- {k}: {v}\n"
        content += "\n"

    # -----------------------------------------------------------------------
    # 6. 关键路径速查表（绝对路径）
    # -----------------------------------------------------------------------
    content += "## 关键路径速查表\n\n"
    content += "| 用途 | 绝对路径 |\n"
    content += "|------|----------|\n"
    content += f"| 工作根目录 | `{BASE_DIR}` |\n"
    content += f"| AGENT.md | `{agent_md_path}` |\n"
    content += f"| Skills 根目录 | `{SKILLS_DIR}` |\n"
    for skill_name in skill_names:
        for py_file in sorted((SKILLS_DIR / skill_name).glob("*.py")) if (SKILLS_DIR / skill_name).exists() else []:
            content += f"| {skill_name}/{py_file.name} | `{py_file.resolve()}` |\n"
    content += f"| 原始论文数据目录 | `{(BASE_DIR / 'data').resolve()}` |\n"
    content += f"| PDF 存储目录 | `{(BASE_DIR / 'data' / 'pdfs').resolve()}` |\n"
    content += f"| 知识库目录 | `{(BASE_DIR / 'knowledge_base').resolve()}` |\n"
    content += "\n"

    return content

def run_recursive_meta_agent(goal_dir: Path) -> Dict[str, Any]:
    """
    调用 recursive-meta-agent 执行任务。

    通过直接导入调用 recursive-meta-agent 的 run_agent 函数。
    """
    # 检查 recursive-meta-agent 目录
    if not RECURSIVE_META_AGENT_DIR.exists():
        return {
            "status": "error",
            "reason": f"recursive-meta-agent not found at {RECURSIVE_META_AGENT_DIR}",
        }

    main_py = RECURSIVE_META_AGENT_DIR / "main.py"
    if not main_py.exists():
        return {"status": "error", "reason": f"main.py not found at {main_py}"}

    # 确保 recursive-meta-agent 的 src 目录在路径中
    src_dir = RECURSIVE_META_AGENT_DIR / "src"
    if str(src_dir) not in sys.path:
        sys.path.insert(0, str(src_dir))

    # 尝试导入 run_agent
    try:
        from agent import run_agent as meta_agent_run
    except ImportError as e:
        return {
            "status": "error",
            "reason": f"Failed to import run_agent: {e}",
        }

    # 从配置中获取 LLM 配置
    llm_config = {}
    try:
        agent_config = load_agent_config()
        llm_config = agent_config.get("llm", {})
    except Exception:
        pass

    # 设置环境变量 (优先级: 环境变量 > 配置文件)
    if "LLM_API_KEY" not in os.environ:
        os.environ["LLM_API_KEY"] = llm_config.get(
            "apiKey", os.environ.get("LLM_API_KEY", "")
        )
    if "LLM_MODEL" not in os.environ:
        os.environ["LLM_MODEL"] = llm_config.get("model", "MiniMax-M2.5")
    if "LLM_BASE_URL" not in os.environ:
        os.environ["LLM_BASE_URL"] = llm_config.get(
            "baseUrl", "http://35.220.164.252:3888/v1"
        )

    # 设置额外的环境变量
    os.environ["MAX_DEPTH"] = str(llm_config.get("max_depth", 4))
    os.environ["MAX_RETRY"] = str(llm_config.get("max_retry", 3))

    print(f"\n{'=' * 60}")
    print(f"Recursive Survey Agent Workflow 启动")
    print(f"{'=' * 60}")
    print(f"Goal Directory: {goal_dir}")
    print(f"LLM: {os.environ.get('LLM_MODEL')} @ {os.environ.get('LLM_BASE_URL')}")
    print(f"{'=' * 60}\n")

    try:
        # 直接调用 run_agent 函数
        goal_dir_str = str(goal_dir)
        meta_agent_run(goal_dir_str)

        # 检查结果
        results_path = goal_dir / "results.md"
        if results_path.exists():
            results_content = results_path.read_text(encoding="utf-8")

            # 检查是否是 escalation
            if (
                "escalated" in results_content.lower()
                or "error" in results_content.lower()
            ):
                return {
                    "status": "escalated",
                    "results": results_content,
                    "goal_dir": str(goal_dir),
                }

            return {
                "status": "completed",
                "results": results_content,
                "goal_dir": str(goal_dir),
            }
        else:
            return {
                "status": "error",
                "reason": "results.md not found after execution",
                "goal_dir": str(goal_dir),
            }

    except Exception as e:
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

    # 设置 goal 目录
    goal_dir = setup_goal_directory(goal, config, args)

    # 执行 recursive-meta-agent
    result = run_recursive_meta_agent(goal_dir)

    # 输出结果
    print(f"\n{'=' * 60}")
    print("Recursive Survey Agent Workflow 完成")
    print(f"{'=' * 60}")
    print(f"Status: {result.get('status', 'unknown')}")

    if result.get("status") in ("completed", "escalated"):
        print(f"Goal Directory: {result.get('goal_dir')}")
        print("Agent execution completed.")
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
        "goal_dir": result.get("goal_dir"),
        "timestamp": datetime.now().isoformat(),
    }
    log_file = BASE_DIR / "data" / "run_log.jsonl"
    with open(log_file, "a", encoding="utf-8") as f:
        f.write(json.dumps(log_entry, ensure_ascii=False) + "\n")

    print(f"\nLog written to: {log_file}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
