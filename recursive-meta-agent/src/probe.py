"""
Probe 函数
以最小代价理解任务形状——退化为纯确定性操作，不调用 LLM。

context.md 的写入规则：
  - 写入时机1：probe 阶段初始化（本文件）
  - 写入时机2：execute_decompose 中每个子节点完成后追加 observation（executor.py）
  - 其他任何地方不得写入 context.md
"""

import os
import re
import subprocess
from typing import Dict, Any, Optional, Set, List, Tuple


# 默认 context 预算（tokens）
DEFAULT_CONTEXT_BUDGET = 100000


def probe(
    goal_dir: str,
    goal: str,
    permissions: dict,
    logger,
    depth: int = 0,
    permissions_dir: Optional[str] = None,
) -> str:
    """
    初始化当前节点的 context.md，返回 context 字符串。

    固定读取：
    1. 目录结构快照
    2. 允许的外部目录（skills 等，来自 permissions）
    3. 父节点 context.md（仅 depth > 0，读取时去重）
    4. 父节点 goal.md 的"后续兄弟任务"段落（仅 depth > 0）
    5. 解引用父节点 context.md 中的 <<read>> 块
    """
    # 根节点的首次 context 初始化可以由上层（如 recursive_survey_agent）预先完成，
    # 此处如果检测到 depth == 0 且 context.md 已存在，则直接复用，不再覆盖，
    # 避免破坏上层为特定 workflow 精心构建的大 context。
    context_path = os.path.join(goal_dir, "context.md")
    if depth == 0 and os.path.exists(context_path):
        with open(context_path, "r", encoding="utf-8") as f:
            context = f.read()
        logger.log_trace(
            kind="probe_root_context_reused",
            node=goal_dir,
            context_length=len(context),
        )
        return context

    parts = []

    # 1. 目录结构
    tree = _get_directory_tree(goal_dir)
    parts.append(f"# Directory structure\n{tree}")

    # 2. 允许的外部目录（skills、tools 等）
    external = _get_external_directories(goal_dir, permissions, permissions_dir)
    if external:
        parts.append(f"# Allowed external directories\n{external}")

    # 3. 父节点 context（子节点继承前驱信息，读取时去重）
    parent_context_content = ""
    if depth > 0:
        parent_dir = os.path.normpath(os.path.join(goal_dir, ".."))
        parent_context_path = os.path.join(parent_dir, "context.md")
        if os.path.exists(parent_context_path):
            parent_context = _read_parent_context_dedupe(parent_context_path)
            if parent_context:
                parent_context_content = parent_context
                parts.append(f"# Parent context\n{parent_context}")

        # 4. 读取父节点 goal.md 的"后续兄弟任务"段落
        parent_goal_path = os.path.join(parent_dir, "goal.md")
        if os.path.exists(parent_goal_path):
            sibling_tasks = _extract_sibling_tasks(parent_goal_path)
            if sibling_tasks:
                parts.append(f"# Parent's subsequent sibling tasks\n{sibling_tasks}")

    context = "\n\n---\n\n".join(parts)

    # 计算当前 context 的 tokens
    context_tokens = _count_tokens(context)

    # 5. 解引用父节点 context.md 中的 <<read>> 块
    if depth > 0 and parent_context_content:
        context, _ = _resolve_read_blocks(
            parent_context_content, context, context_tokens, goal_dir
        )

    # 写入 context.md（时机1：初始化）
    with open(context_path, "w", encoding="utf-8") as f:
        f.write(context)

    logger.log_trace(kind="probe_completed", node=goal_dir, context_length=len(context))
    return context


def _extract_sibling_tasks(parent_goal_path: str) -> str:
    """
    从父节点 goal.md 中提取"后续兄弟任务"段落。
    """
    try:
        with open(parent_goal_path, "r", encoding="utf-8") as f:
            content = f.read()

        # 查找 "## 后续兄弟任务" 段落
        pattern = r"## 后续兄弟任务\s*\n(.*?)(?=\n## |\Z)"
        match = re.search(pattern, content, re.DOTALL)
        if match:
            sibling_section = match.group(1).strip()
            # 清理内容，移除空行
            lines = [
                line.strip() for line in sibling_section.splitlines() if line.strip()
            ]
            return "\n".join(lines)
    except Exception:
        pass
    return ""


def _resolve_read_blocks(
    parent_context: str, current_context: str, current_tokens: int, goal_dir: str
) -> Tuple[str, int]:
    """
    解引用 parent_context 中的 <<read>> 块。

    情况一：文件不存在
    <<read:error>> path/to/file 不存在 <<read/>>

    情况二：文件在预算内
    直接替换为文件内容：
    # path/to/file
    （完整文件内容）

    情况三：文件超出剩余 context 预算
    替换为截断内容，附加提示：
    # path/to/file
    [截断：仅显示前 N tokens，文件共 M tokens]
    （截断范围内的文件内容）
    [如需读取更多，可创建子任务：读取 offset=N 之后的部分，替换父节点 context.md 中本段内容]

    返回：(解引用后的 current_context, 更新后的 tokens 数)
    """
    # 正则提取所有 <<read>> 块
    read_pattern = r"<<read>>\s*(.*?)\s*<<read/>>"
    matches = list(re.finditer(read_pattern, parent_context))

    if not matches:
        return current_context, current_tokens

    # 计算剩余预算
    total_budget = DEFAULT_CONTEXT_BUDGET
    remaining_budget = total_budget - current_tokens

    resolved_parts = []
    last_end = 0

    parent_dir = os.path.normpath(os.path.join(goal_dir, ".."))

    for match in matches:
        file_path = match.group(1).strip()
        abs_path = os.path.abspath(os.path.join(parent_dir, file_path))

        # 添加匹配之前的内容
        resolved_parts.append(parent_context[last_end : match.start()])

        # 解引用文件
        resolved_content, consumed_tokens = _resolve_single_file(
            file_path, abs_path, remaining_budget
        )
        resolved_parts.append(resolved_content)
        remaining_budget -= consumed_tokens
        current_tokens += consumed_tokens

        last_end = match.end()

    # 添加剩余内容
    resolved_parts.append(parent_context[last_end:])

    resolved_context = "".join(resolved_parts)
    return resolved_context, current_tokens


def _resolve_single_file(
    file_path: str, abs_path: str, remaining_budget: int
) -> Tuple[str, int]:
    """
    解引用单个文件。
    返回：(替换内容, 消耗的 tokens)
    """
    if not os.path.exists(abs_path):
        error_content = f"<<read:error>> {file_path} 不存在 <<read/>>"
        return error_content, _count_tokens(error_content)

    try:
        with open(abs_path, "r", encoding="utf-8") as f:
            file_content = f.read()

        file_tokens = _count_tokens(file_content)

        # 情况二：文件在预算内
        if file_tokens <= remaining_budget:
            header = f"# {file_path}\n"
            return header + file_content, _count_tokens(header) + file_tokens

        # 情况三：文件超出剩余预算，需要截断
        # 按比例分配剩余预算
        return _truncate_file(file_path, file_content, file_tokens, remaining_budget)

    except Exception as e:
        error_content = f"<<read:error>> {file_path} 读取失败: {e} <<read/>>"
        return error_content, _count_tokens(error_content)


def _truncate_file(
    file_path: str, file_content: str, file_tokens: int, remaining_budget: int
) -> Tuple[str, int]:
    """
    截断文件内容以适应剩余预算。
    返回：(截断内容, 消耗的 tokens)
    """
    # 估算每个字符对应的 tokens 数（中文约 1.5，英文约 4）
    # 使用粗略估算：假设平均 3 个字符 = 1 token
    chars_per_token = 3
    max_chars = remaining_budget * chars_per_token

    if len(file_content) <= max_chars:
        # 实际内容可以全部放入
        header = f"# {file_path}\n"
        return header + file_content, _count_tokens(header) + file_tokens

    # 截断内容
    truncated_content = file_content[: int(max_chars)]
    header = f"# {file_path}\n"
    truncation_note = (
        f"\n[截断：仅显示前 {remaining_budget} tokens，文件共 {file_tokens} tokens]\n"
    )

    footer = f"\n[如需读取更多，可创建子任务：读取 offset={len(truncated_content)} 之后的部分，替换父节点 context.md 中本段内容]"

    full_content = header + truncated_content + truncation_note + footer
    consumed_tokens = (
        remaining_budget + _count_tokens(truncation_note) + _count_tokens(footer)
    )

    return full_content, consumed_tokens


def _count_tokens(text: str) -> int:
    """
    计算文本的 tokens 数量。
    使用简单估算：中文约 1.5 tokens/字符，英文约 0.25 tokens/字符。
    """
    # 简单估算：中文约 1.5 tokens/字符，英文约 0.25 tokens/字符
    chinese_chars = len(re.findall(r"[\u4e00-\u9fff]", text))
    other_chars = len(text) - chinese_chars
    return int(chinese_chars * 1.5 + other_chars * 0.25)


def _read_parent_context_dedupe(parent_context_path: str) -> str:
    """
    读取父节点 context，去除重复的公共部分（目录结构、Allowed external directories）。
    只保留父节点独有信息（子任务 observation）。
    """
    with open(parent_context_path, "r", encoding="utf-8") as f:
        content = f.read()

    lines = content.split("\n")
    result_lines = []
    skip_until_next_section = False

    for line in lines:
        stripped = line.strip()

        # 跳过公共部分：Directory structure 和 Allowed external directories
        if stripped.startswith("# Directory structure"):
            skip_until_next_section = True
            continue
        if stripped.startswith("# Allowed external directories"):
            skip_until_next_section = True
            continue
        if stripped.startswith("# Parent context"):
            skip_until_next_section = True
            continue
        if stripped == "---":
            skip_until_next_section = False
            continue

        # 跳过重复的外部目录引用
        if stripped.startswith("## From: ../../"):
            continue

        if not skip_until_next_section:
            result_lines.append(line)

    # 清理空行
    result_lines = [l for l in result_lines if l.strip()]

    return "\n".join(result_lines)


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
    goal_dir: str, permissions: dict, permissions_dir: Optional[str] = None
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
