"""
Probe 函数
以最小代价理解任务形状 - 退化为纯确定性操作
"""

import os
import subprocess
from typing import Dict, Any, List, Optional
from logger import get_logger
from primitives import make_primitives


def probe(
    goal_dir: str,
    goal: str,
    permissions: dict,
    logger,
    depth: int = 0,
    permissions_dir: str = None,
) -> str:
    """
    以最小代价理解任务形状 - 退化为纯确定性操作。
    1. bash 扫描目录结构和文件大小
    2. 自动读取固定候选文件：
       - goal.md（当前节点，必读）
       - ../context.md（父节点 context，仅 depth > 0 时加入）
       - results.md（如存在，说明是 retry，读取上次结果）
       - .agent/memory.jsonl 最近 5 条（保留）
       - permissions.json 中允许的外部目录结构（新增）
    3. 把以上内容拼成 context 字符串，写入 context.md，返回
    """
    parts = []

    # 1. 目录结构快照
    tree = get_directory_tree(goal_dir)
    parts.append(f"# Directory structure\n{tree}")

    # 1.5. Allowed external directories (从 permissions.json 读取)
    # permissions_dir 是 permissions.json 所在的目录，用于正确解析相对路径
    external_dirs_info = get_external_directories(
        goal_dir, permissions, permissions_dir
    )
    if external_dirs_info:
        parts.append(f"# Allowed external directories\n{external_dirs_info}")

    # 2. 父节点 context（子节点专属，depth > 0）
    if depth > 0:
        parent_context_path = os.path.join(goal_dir, "..", "context.md")
        if os.path.exists(parent_context_path):
            with open(parent_context_path, "r", encoding="utf-8") as f:
                content = f.read()
            parts.append(f"# Parent context\n{content}")

    # 3. 上次执行结果（retry 场景）
    results_path = os.path.join(goal_dir, "results.md")
    if os.path.exists(results_path):
        with open(results_path, "r", encoding="utf-8") as f:
            content = f.read()
        parts.append(f"# Previous execution result\n{content}")

    # 4. 历史记忆
    memory = get_memory_hint(logger)
    if memory:
        parts.append(f"# Memory hints\n{memory}")

    # 拼接 context
    context = "\n\n---\n\n".join(parts)

    # 写入 context.md
    context_path = os.path.join(goal_dir, "context.md")
    with open(context_path, "w", encoding="utf-8") as f:
        f.write(context)

    # 记录 probe 完成
    logger.log_trace(
        kind="probe_completed",
        node=goal_dir,
        context_length=len(context),
    )

    return context


def get_directory_tree(goal_dir: str) -> str:
    """获取目录结构"""
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
        return f"Error getting directory tree: {str(e)}"


def get_external_directories(
    goal_dir: str, permissions: dict, permissions_dir: str = None
) -> str:
    """
    获取 permissions.json 中允许的外部目录结构
    扫描 permissions 中配置的 read 路径，列出可用的 skills 和工具
    permissions_dir: permissions.json 所在的目录，用于正确解析相对路径
    """
    try:
        allowed_read = permissions.get("read", [])
        if not allowed_read:
            return ""

        lines = []

        # 如果没有提供 permissions_dir，使用 goal_dir
        if permissions_dir is None:
            permissions_dir = os.path.abspath(goal_dir)

        for rel_path in allowed_read:
            # 跳过特殊路径
            if rel_path in [".", ".."]:
                continue

            # 解析绝对路径 - 基于 permissions.json 所在的目录
            abs_path = os.path.abspath(os.path.join(permissions_dir, rel_path))

            if not os.path.exists(abs_path):
                continue

            # 获取目录结构 (maxdepth 3 以获取足够信息但不过多)
            try:
                result = subprocess.run(
                    f"find {abs_path} -maxdepth 3 -type f -name '*.py' -o -name '*.md' | head -30",
                    shell=True,
                    capture_output=True,
                    text=True,
                    timeout=10,
                )
                if result.stdout:
                    lines.append(f"\n## From: {rel_path}")
                    lines.append(result.stdout)
            except Exception:
                continue

        if not lines:
            return ""

        # 添加说明，提示 agent 可以读取这些目录
        header = "You have read access to these external directories. Check for SKILL.md files to understand how to use each skill."
        return header + "\n" + "\n".join(lines)

    except Exception as e:
        return ""


def get_memory_hint(logger) -> str:
    """获取历史记忆"""
    try:
        memories = logger.get_recent_memory(limit=5)
        if not memories:
            return ""

        hint_lines = ["## Recent Task Patterns:\n"]
        for mem in memories:
            hint_lines.append(f"- Task: {mem.get('task_type', 'unknown')}")
            hint_lines.append(f"  Summary: {mem.get('goal_summary', '')[:100]}")
            hint_lines.append(f"  Reliability: {mem.get('reliability', 0)}")
            hint_lines.append(f"  Depth used: {mem.get('depth_used', 0)}")
            hint_lines.append("")

        return "\n".join(hint_lines)
    except Exception:
        return ""


def write_context(goal_dir: str, context: str) -> None:
    """写入 context.md"""
    context_path = os.path.join(goal_dir, "context.md")
    os.makedirs(os.path.dirname(context_path), exist_ok=True)
    with open(context_path, "w", encoding="utf-8") as f:
        f.write(context)
