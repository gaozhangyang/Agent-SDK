"""
Probe 函数
以最小代价理解任务形状
"""

import os
import json
import subprocess
from typing import Dict, Any, List, Optional
from logger import get_logger
from primitives import make_primitives
from prompts import get_file_probe_prompt


def probe(goal_dir: str, goal: str, permissions: dict, logger) -> str:
    """
    以最小代价理解任务形状。
    1. bash 获取目录结构和文件大小（不读文件内容）
    2. 读取 memory.jsonl 最近 5 条作为历史参考
    3. llm_call 决定需要读哪些文件（返回 JSON: {files_by_priority: []}）
    4. 按优先级拉取文件内容，预算耗尽则停止，标记 context_truncated
    5. 写入 context.md
    返回：context 字符串
    """

    # 1. 获取目录结构和文件大小
    tree_output = get_directory_tree(goal_dir)
    sizes_output = get_file_sizes(goal_dir)

    # 2. 获取历史记忆
    memory_hint = get_memory_hint(logger)

    # 3. LLM 决定需要读哪些文件
    files_to_read = ask_llm_for_files(
        tree_output, sizes_output, memory_hint, goal, permissions, logger, goal_dir
    )

    # 4. 按优先级拉取文件内容
    context, truncated = pull_files_with_budget(files_to_read, permissions, goal_dir)

    # 5. 写入 context.md
    context_path = os.path.join(goal_dir, "context.md")
    with open(context_path, "w", encoding="utf-8") as f:
        f.write(context)

    # 记录 probe 完成
    logger.log_trace(
        kind="probe_completed",
        node=goal_dir,
        files_read=len(files_to_read),
        context_truncated=truncated,
    )

    return context


def get_directory_tree(goal_dir: str) -> str:
    """获取目录结构"""
    try:
        result = subprocess.run(
            f"find {goal_dir} -maxdepth 3 -type f -name '*.md' -o -name '*.py' -o -name '*.json' 2>/dev/null | head -50",
            shell=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
        return result.stdout or "No files found"
    except Exception as e:
        return f"Error getting directory tree: {str(e)}"


def get_file_sizes(goal_dir: str) -> str:
    """获取文件大小"""
    try:
        result = subprocess.run(
            f"find {goal_dir} -maxdepth 2 -type f \\( -name '*.md' -o -name '*.py' -o -name '*.json' \\) -exec wc -c {{}} + 2>/dev/null | head -30",
            shell=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
        return result.stdout or "No size info"
    except Exception as e:
        return f"Error getting file sizes: {str(e)}"


def get_memory_hint(logger) -> str:
    """获取历史记忆"""
    try:
        memories = logger.get_recent_memory(limit=5)
        if not memories:
            return "No previous memory available."

        hint_lines = ["## Recent Task Patterns:\n"]
        for mem in memories:
            hint_lines.append(f"- Task: {mem.get('task_type', 'unknown')}")
            hint_lines.append(f"  Summary: {mem.get('goal_summary', '')[:100]}")
            hint_lines.append(f"  Reliability: {mem.get('reliability', 0)}")
            hint_lines.append(f"  Depth used: {mem.get('depth_used', 0)}")
            hint_lines.append("")

        return "\n".join(hint_lines)
    except Exception as e:
        return f"Error getting memory: {str(e)}"


def ask_llm_for_files(
    tree: str,
    sizes: str,
    memory: str,
    goal: str,
    permissions: dict,
    logger,
    node_dir: str,
) -> List[Dict[str, Any]]:
    """
    调用 LLM 决定需要读取哪些文件
    """
    from primitives import make_primitives

    primitives = make_primitives(node_dir, permissions, logger)
    llm_call = primitives["llm_call"]

    # 加载外部 prompt 模板
    file_probe_template = get_file_probe_prompt()
    prompt = file_probe_template.format(
        tree=tree, sizes=sizes, memory=memory, goal=goal
    )

    try:
        result = llm_call(context=[tree, sizes, memory, goal], prompt=prompt)

        # 解析 JSON
        parsed = parse_json_response(result)
        if parsed and "files_by_priority" in parsed:
            return parsed["files_by_priority"]

    except Exception as e:
        logger.log_trace(kind="probe_llm_error", node=node_dir, error=str(e))

    # 默认返回空列表
    return []


def parse_json_response(response: str) -> Optional[Dict[str, Any]]:
    """解析 LLM 返回的 JSON"""
    import re

    # 尝试直接解析
    try:
        return json.loads(response)
    except json.JSONDecodeError:
        pass

    # 尝试提取 JSON 块
    json_match = re.search(r"\{[\s\S]*\}", response)
    if json_match:
        try:
            return json.loads(json_match.group())
        except json.JSONDecodeError:
            pass

    return None


def pull_files_with_budget(
    files_to_read: List[Dict[str, Any]], permissions: dict, goal_dir: str
) -> tuple:
    """
    按优先级拉取文件内容，预算耗尽则停止
    返回: (context_str, truncated)
    """
    context_parts = []
    truncated = False

    # 获取 token 预算
    context_budget = permissions.get(
        "context_budget", {"total": 200000, "reservedOutput": 4000}
    )
    budget = context_budget.get("total", 200000) - context_budget.get(
        "reservedOutput", 4000
    )

    current_tokens = 0

    # 按优先级排序
    priority_order = {"high": 0, "medium": 1, "low": 2}
    sorted_files = sorted(
        files_to_read, key=lambda x: priority_order.get(x.get("priority", "low"), 2)
    )

    for file_info in sorted_files:
        path = file_info.get("path")
        if not path:
            continue

        # 处理相对路径
        if not os.path.isabs(path):
            path = os.path.join(goal_dir, path)

        # 检查权限
        if not check_file_readable(path, goal_dir, permissions):
            context_parts.append(f"## {path}\n[Permission denied]\n")
            continue

        # 读取文件
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    content = f.read()

                # 检查预算
                file_tokens = len(content) // 4
                if current_tokens + file_tokens > budget:
                    truncated = True
                    break

                context_parts.append(f"## {path}\n{content}\n")
                current_tokens += file_tokens

            except Exception as e:
                context_parts.append(f"## {path}\n[Error reading: {str(e)}]\n")
        else:
            context_parts.append(f"## {path}\n[File not found]\n")

    if truncated:
        context_parts.append("\n\n[Context truncated due to token budget]\n")

    return "\n\n".join(context_parts), truncated


def check_file_readable(path: str, node_dir: str, permissions: dict) -> bool:
    """检查文件是否可读"""
    from permissions import check_read_permission

    return check_read_permission(path, permissions, node_dir)


def write_context(goal_dir: str, context: str) -> None:
    """写入 context.md"""
    context_path = os.path.join(goal_dir, "context.md")
    os.makedirs(os.path.dirname(context_path), exist_ok=True)
    with open(context_path, "w", encoding="utf-8") as f:
        f.write(context)
