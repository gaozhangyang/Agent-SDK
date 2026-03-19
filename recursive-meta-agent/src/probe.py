"""
Probe 阶段：构建节点 context.md。
"""

from __future__ import annotations

import os
import re
import subprocess
from typing import Optional, Tuple

from agent_config import build_agent_context, load_agent_config


DEFAULT_CONTEXT_BUDGET = 100000


def probe(
    goal_dir: str,
    goal: str,
    permissions: dict,
    logger,
    depth: int = 0,
    permissions_dir: Optional[str] = None,
) -> str:
    context_path = os.path.join(goal_dir, "context.md")
    agent_config = load_agent_config(goal_dir)

    parts = [f"# Goal\n{goal.strip() or '(empty goal)'}"]
    parts.append(f"# Directory structure\n{get_directory_tree(goal_dir)}")

    external = _get_external_directories(goal_dir, permissions, permissions_dir)
    if external:
        parts.append(f"# Allowed external directories\n{external}")

    agent_context = build_agent_context(agent_config, "planner")
    if agent_context:
        parts.append(f"# AGENT configuration\n{agent_context}")

    parent_context_content = ""
    if depth > 0:
        parent_dir = os.path.normpath(os.path.join(goal_dir, ".."))
        parent_context_path = os.path.join(parent_dir, "context.md")
        if os.path.exists(parent_context_path):
            parent_context = _read_parent_context_dedupe(parent_context_path)
            if parent_context:
                parent_context_content = parent_context
                parts.append(f"# Parent context\n{parent_context}")

        parent_goal_path = os.path.join(parent_dir, "goal.md")
        if os.path.exists(parent_goal_path):
            sibling_tasks = _extract_sibling_tasks(parent_goal_path)
            if sibling_tasks:
                parts.append(f"# Parent's subsequent sibling tasks\n{sibling_tasks}")

    context = "\n\n---\n\n".join(parts)
    context_tokens = _count_tokens(context)
    if depth > 0 and parent_context_content:
        context, _ = _resolve_read_blocks(
            parent_context_content, context, context_tokens, goal_dir
        )

    max_chars = int(
        agent_config.get("context_max_chars", permissions.get("context_max_chars", 800000))
    )
    if len(context) > max_chars:
        context = context[:max_chars] + "\n\n[Context truncated due to character limit]"

    write_context(goal_dir, context)
    return context


def _extract_sibling_tasks(parent_goal_path: str) -> str:
    try:
        with open(parent_goal_path, "r", encoding="utf-8") as f:
            content = f.read()
        match = re.search(r"## 后续兄弟任务\s*\n(.*?)(?=\n## |\Z)", content, re.DOTALL)
        if not match:
            return ""
        return "\n".join(
            line.strip() for line in match.group(1).splitlines() if line.strip()
        )
    except Exception:
        return ""


def _resolve_read_blocks(
    parent_context: str, current_context: str, current_tokens: int, goal_dir: str
) -> Tuple[str, int]:
    matches = list(re.finditer(r"<<read>>\s*(.*?)\s*<<read/>>", parent_context))
    if not matches:
        return current_context, current_tokens

    agent_config = load_agent_config(goal_dir)
    budget = agent_config.get("context_budget", {})
    total_budget = int(budget.get("total", DEFAULT_CONTEXT_BUDGET))
    remaining_budget = max(total_budget - current_tokens, 0)
    parent_dir = os.path.normpath(os.path.join(goal_dir, ".."))

    resolved_parts = []
    last_end = 0
    for match in matches:
        resolved_parts.append(parent_context[last_end : match.start()])
        file_path = match.group(1).strip()
        abs_path = os.path.abspath(os.path.join(parent_dir, file_path))
        resolved_content, consumed_tokens = _resolve_single_file(
            file_path, abs_path, remaining_budget
        )
        resolved_parts.append(resolved_content)
        remaining_budget = max(remaining_budget - consumed_tokens, 0)
        current_tokens += consumed_tokens
        last_end = match.end()
    resolved_parts.append(parent_context[last_end:])
    return "".join(resolved_parts), current_tokens


def _resolve_single_file(
    file_path: str, abs_path: str, remaining_budget: int
) -> Tuple[str, int]:
    if not os.path.exists(abs_path):
        error_content = f"<<read:error>> {file_path} not found <<read/>>"
        return error_content, _count_tokens(error_content)

    try:
        with open(abs_path, "r", encoding="utf-8") as f:
            file_content = f.read()
    except Exception as exc:
        error_content = f"<<read:error>> {file_path} read failed: {exc} <<read/>>"
        return error_content, _count_tokens(error_content)

    file_tokens = _count_tokens(file_content)
    if file_tokens <= remaining_budget:
        rendered = f"# {file_path}\n{file_content}"
        return rendered, _count_tokens(rendered)
    return _truncate_file(file_path, file_content, file_tokens, remaining_budget)


def _truncate_file(
    file_path: str, file_content: str, file_tokens: int, remaining_budget: int
) -> Tuple[str, int]:
    if remaining_budget <= 0:
        content = (
            f"# {file_path}\n"
            f"[Truncated: file has {file_tokens} estimated tokens and no context budget remains]"
        )
        return content, _count_tokens(content)

    max_chars = remaining_budget * 3
    truncated_content = file_content[:max_chars]
    rendered = (
        f"# {file_path}\n"
        f"[Truncated: showing first {remaining_budget} estimated tokens; full file has {file_tokens} tokens]\n"
        f"{truncated_content}\n"
        f"[Create a follow-up subtask to continue reading from char offset {len(truncated_content)} if needed]"
    )
    return rendered, _count_tokens(rendered)


def _count_tokens(text: str) -> int:
    chinese_chars = len(re.findall(r"[\u4e00-\u9fff]", text))
    other_chars = len(text) - chinese_chars
    return int(chinese_chars * 1.5 + other_chars * 0.25)


def _read_parent_context_dedupe(parent_context_path: str) -> str:
    with open(parent_context_path, "r", encoding="utf-8") as f:
        lines = f.read().splitlines()

    result = []
    skip_section = False
    for line in lines:
        stripped = line.strip()
        if stripped in (
            "# Directory structure",
            "# Allowed external directories",
            "# Parent context",
        ):
            skip_section = True
            continue
        if stripped == "---":
            skip_section = False
            continue
        if not skip_section:
            result.append(line)
    return "\n".join(line for line in result if line.strip())


def get_directory_tree(goal_dir: str) -> str:
    try:
        result = subprocess.run(
            ["find", goal_dir, "-maxdepth", "2", "-type", "f"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        files = [line for line in result.stdout.splitlines()[:40] if line.strip()]
        return "\n".join(files) if files else "No files found"
    except Exception as exc:
        return f"Error getting directory tree: {exc}"


def write_context(goal_dir: str, context: str) -> None:
    os.makedirs(goal_dir, exist_ok=True)
    with open(os.path.join(goal_dir, "context.md"), "w", encoding="utf-8") as f:
        f.write(context)


def _get_external_directories(
    goal_dir: str, permissions: dict, permissions_dir: Optional[str] = None
) -> str:
    allowed_read = permissions.get("read", [])
    if not allowed_read:
        return ""

    base = permissions_dir or os.path.abspath(goal_dir)
    outputs = []
    for rel_path in allowed_read:
        if rel_path in (".", ".."):
            continue
        abs_path = os.path.abspath(os.path.join(base, rel_path))
        if not os.path.exists(abs_path):
            continue
        try:
            result = subprocess.run(
                ["find", abs_path, "-maxdepth", "3", "-type", "f"],
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
            files = [
                line
                for line in result.stdout.splitlines()
                if line.endswith(".md") or line.endswith(".py")
            ][:30]
            if files:
                outputs.append(f"## From: {rel_path}\n" + "\n".join(files))
        except Exception:
            continue

    if not outputs:
        return ""
    return (
        "You have read access to these external directories. Prefer reusing documented skills and tools.\n"
        + "\n\n".join(outputs)
    )
