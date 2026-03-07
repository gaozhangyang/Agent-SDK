"""
Probe 函数
以最小代价理解任务形状——退化为纯确定性操作，不调用 LLM。

context.md 的写入规则（变更4）：
  - 写入时机1：probe 阶段初始化（本文件）
  - 写入时机2：execute_decompose 中每个子节点完成后追加 OBSERVATIONS（executor.py）
  - 其他任何地方不得写入 context.md
"""

import os
import subprocess
from typing import Dict, Any, Optional


def probe(
    goal_dir: str,
    goal: str,
    permissions: dict,
    logger,
    depth: int = 0,
    permissions_dir: str = None,
) -> str:
    """
    初始化当前节点的 context.md，返回 context 字符串。

    固定读取：
    1. 目录结构快照
    2. 允许的外部目录（skills 等，来自 permissions）
    3. 父节点 context.md（仅 depth > 0）
    4. 上次执行结果（retry 场景，results.md 已存在）
    5. 历史记忆（最近 5 条）
    """
    parts = []

    # 1. 目录结构
    tree = _get_directory_tree(goal_dir)
    parts.append(f"# Directory structure\n{tree}")

    # 2. 允许的外部目录（skills、tools 等）
    external = _get_external_directories(goal_dir, permissions, permissions_dir)
    if external:
        parts.append(f"# Allowed external directories\n{external}")

    # 3. 父节点 context（子节点继承前驱信息）
    if depth > 0:
        parent_context_path = os.path.normpath(os.path.join(goal_dir, "..", "context.md"))
        if os.path.exists(parent_context_path):
            with open(parent_context_path, "r", encoding="utf-8") as f:
                parts.append(f"# Parent context\n{f.read()}")

    # 4. 上次执行结果（retry 场景）
    results_path = os.path.join(goal_dir, "results.md")
    if os.path.exists(results_path):
        with open(results_path, "r", encoding="utf-8") as f:
            parts.append(f"# Previous execution result\n{f.read()}")

    # 5. 历史记忆
    memory = _get_memory_hint(logger)
    if memory:
        parts.append(f"# Memory hints\n{memory}")

    context = "\n\n---\n\n".join(parts)

    # 写入 context.md（时机1：初始化）
    context_path = os.path.join(goal_dir, "context.md")
    with open(context_path, "w", encoding="utf-8") as f:
        f.write(context)

    logger.log_trace(kind="probe_completed", node=goal_dir, context_length=len(context))
    return context


def _get_directory_tree(goal_dir: str) -> str:
    """获取目录结构快照"""
    try:
        result = subprocess.run(
            f"find {goal_dir} -maxdepth 2 -type f | head -40",
            shell=True, capture_output=True, text=True, timeout=10,
        )
        return result.stdout or "No files found"
    except Exception as e:
        return f"Error getting directory tree: {e}"


def _get_external_directories(
    goal_dir: str, permissions: dict, permissions_dir: str = None
) -> str:
    """
    扫描 permissions 中配置的 read 路径（通常是 skills 目录），
    列出可用的 SKILL.md 等说明文件。
    """
    allowed_read = permissions.get("read", [])
    if not allowed_read:
        return ""

    base = permissions_dir or os.path.abspath(goal_dir)
    lines = []

    for rel_path in allowed_read:
        if rel_path in (".", ".."):
            continue
        abs_path = os.path.abspath(os.path.join(base, rel_path))
        if not os.path.exists(abs_path):
            continue
        try:
            result = subprocess.run(
                f"find {abs_path} -maxdepth 3 -type f \\( -name '*.py' -o -name '*.md' \\) | head -30",
                shell=True, capture_output=True, text=True, timeout=10,
            )
            if result.stdout:
                lines.append(f"\n## From: {rel_path}\n{result.stdout}")
        except Exception:
            continue

    if not lines:
        return ""

    header = "You have read access to these external directories. Check SKILL.md files for usage."
    return header + "\n" + "\n".join(lines)


def _get_memory_hint(logger) -> str:
    """获取历史记忆（最近 5 条）"""
    try:
        memories = logger.get_recent_memory(limit=5)
        if not memories:
            return ""
        lines = ["## Recent Task Patterns:\n"]
        for mem in memories:
            lines.append(f"- Task: {mem.get('task_type', 'unknown')}")
            lines.append(f"  Summary: {mem.get('goal_summary', '')[:100]}")
            lines.append(f"  Reliability: {mem.get('reliability', 0)}")
            lines.append(f"  Depth used: {mem.get('depth_used', 0)}")
            lines.append("")
        return "\n".join(lines)
    except Exception:
        return ""