"""
Probe 函数
以最小代价理解任务形状——退化为纯确定性操作，不调用 LLM。

global context 的读取规则（变更1）：
  - 读取时机：probe 阶段读取 global context，拼接进 prompt
  - 写入时机：execute_with_verification 中 verifier 完成后写入 global context（executor.py）
  - 位置：{rootGoalDir}/global_context.md
  - 各节点本地 context.md 不再创建和维护
"""

import os
import subprocess
from typing import Dict, Any, Optional


def _find_root_goal_dir(goal_dir: str) -> str:
    """
    向上遍历找到根目标目录（包含 goal.md 的最顶层目录）
    """
    current = goal_dir
    while current:
        parent = os.path.dirname(current)
        if not parent or parent == current:
            # 到达文件系统根目录，返回原始目录
            return goal_dir
        goal_path = os.path.join(parent, "goal.md")
        if os.path.exists(goal_path):
            current = parent
        else:
            break
    return current


def _read_global_context(goal_dir: str) -> str:
    """
    读取根目标目录下的 global_context.md
    """
    root_goal_dir = _find_root_goal_dir(goal_dir)
    global_context_path = os.path.join(root_goal_dir, "global_context.md")
    if os.path.exists(global_context_path):
        with open(global_context_path, "r", encoding="utf-8") as f:
            return f.read()
    return ""


def probe(
    goal_dir: str,
    goal: str,
    permissions: dict,
    logger,
    depth: int = 0,
    permissions_dir: str = None,
) -> str:
    """
    初始化当前节点的 context，返回 context 字符串。

    固定读取：
    1. 目录结构快照
    2. 允许的外部目录（skills 等，来自 permissions）
    3. 根节点的 global context（所有节点的 observations 累积）
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

    # 3. 根节点的 global context（所有节点的 observations 累积）
    global_context = _read_global_context(goal_dir)
    if global_context:
        parts.append(f"# Global context\n{global_context}")

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

    # 注意：不再写入本地 context.md，改为写入 global context
    logger.log_trace(kind="probe_completed", node=goal_dir, context_length=len(context))
    return context


def _get_directory_tree(goal_dir: str) -> str:
    """获取目录结构快照"""
    try:
        result = subprocess.run(
            f"find {goal_dir} -maxdepth 2 -type f | head -40",
            shell=True,
            capture_output=True,
            text=True,
            timeout=10,
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
                shell=True,
                capture_output=True,
                text=True,
                timeout=10,
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
