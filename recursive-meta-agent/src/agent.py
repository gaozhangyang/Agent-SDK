"""
Meta-Agent 核心递归函数
"""

import os
import json
import uuid
from datetime import datetime
from typing import Dict, Any, Optional

from logger import get_logger
from permissions import load_permissions
from probe import probe
from executor import (
    execute_decompose,
    execute_with_verification,
    write_results,
    append_to_parent_context,
)
from deps import validate_dependencies, ValidationError
from prompts import get_decision_prompt

MAX_DEPTH = int(os.environ.get("MAX_DEPTH", "4"))


def meta_agent(
    goal_dir: str,
    depth: int = 0,
    display_index: Optional[int] = None,
) -> None:
    """
    输入：一个包含 goal.md 的目录
    输出：observation 写入父节点 context.md（根节点写入 results.md）
    副作用：写 context.md、script.py、全局记录

    算法逻辑（按 change.md）：
    1. probe: 读取父节点 context.md + 当前环境，形成当前节点的上下文
    2. decision: 直接执行或分解
    3. 执行模式根据 change.md 逻辑处理
    4. 无论成败，observation 写入父节点 context.md
    5. 根节点例外：observation 写入 results.md

    display_index: 当前层内的序号（1-based），用于终端显示
    """
    work_dir = os.path.dirname(goal_dir)
    logger = get_logger(work_dir)

    goal_name = os.path.basename(goal_dir.rstrip(os.sep))
    display_label = (
        f"{display_index}. {goal_name}" if display_index is not None else goal_name
    )

    goal = _read_goal(goal_dir)

    permissions, permissions_dir = load_permissions(goal_dir)

    context = ""
    observation = ""  # 初始化 observation
    direct_info = ""  # 初始化 direct_info
    indirect_files = []  # 初始化 indirect_files
    decision_type = "direct"  # 初始化 decision_type

    # Probe：确定性操作，理解任务形状（在深度判断之前执行，确保 context 构建）
    try:
        context = probe(
            goal_dir, goal, permissions, logger, depth, permissions_dir
        )
    except Exception as e:
        context = ""

    # 深度限制 → 强制直接执行（只影响 planner 决策，不影响 context 构建）
    subtasks = []  # 初始化 subtasks
    if depth >= permissions.get("max_depth", MAX_DEPTH):
        decision_type = "direct"
    else:
        # 决策：direct or decompose
        decision_result = _make_decision(context, goal, permissions, logger, goal_dir)
        decision_type = decision_result["type"]
        subtasks = decision_result.get("subtasks", [])

    try:
        if decision_type == "direct":
            # 直接执行模式
            result = execute_with_verification(
                goal_dir, goal, context, permissions, logger, depth
            )
            # 从结果中提取信息
            observation = result.get("observation", "")
            direct_info = result.get("direct_info", "")
            indirect_files = result.get("indirect_files", [])
        else:
            # 分解模式：使用 decision 返回的 subtasks
            if not subtasks:
                # 无法分解，回退到直接执行
                result = execute_with_verification(
                    goal_dir, goal, context, permissions, logger, depth
                )
                observation = result.get("observation", "")
                direct_info = result.get("direct_info", "")
                indirect_files = result.get("indirect_files", [])
            else:
                # 分解执行：每个子任务完成后，其 observer 结果（direct_info + indirect_files）
                # 会在子节点的 meta_agent 末尾写入父节点 context.md
                # 父节点这边不需要额外处理
                execute_decompose(goal_dir, goal, subtasks, depth, permissions, logger)
                # 分解执行完成后，父节点自己的 observation 为空（因为是汇总模式）
                observation = "Decompose completed"
                direct_info = ""
                indirect_files = []

    except Exception as e:
        # 失败时，失败原因本身就是 observation
        observation = f"Failed: {str(e)}"
        direct_info = f"Failed: {str(e)}"
        indirect_files = []

    # 唯一的信息流动：无论成败，observation/direct_info 写入父节点 context.md
    if depth == 0:
        # 根节点例外：写入 results.md
        write_results(goal_dir, observation)
    else:
        # 非根节点：写入父节点 context.md
        parent_dir = os.path.dirname(goal_dir)
        subtask_name = os.path.basename(goal_dir)
        # decompose 模式下 observation = "Decompose completed"，不需要写入
        # 只有 direct 模式需要写入 direct_info 和 indirect_files
        if decision_type == "direct":
            append_to_parent_context(
                parent_dir, subtask_name, direct_info, indirect_files
            )
        elif observation and observation != "Decompose completed":
            # 回退到 direct 模式的情况
            append_to_parent_context(parent_dir, subtask_name, observation, [])


# ---------------------------------------------------------------------------
# 内部工具函数
# ---------------------------------------------------------------------------


def _read_goal(goal_dir: str) -> str:
    goal_path = os.path.join(goal_dir, "goal.md")
    if not os.path.exists(goal_path):
        return ""
    with open(goal_path, "r", encoding="utf-8") as f:
        return f.read()


def _make_decision(
    context: str,
    goal: str,
    permissions: dict,
    logger,
    node_dir: str,
) -> dict:
    """LLM 决策：direct 还是 decompose。返回 {"type": "direct"|"decompose", "subtasks": list}"""
    from primitives import make_primitives

    primitives = make_primitives(node_dir, permissions, logger)
    llm_call = primitives["llm_call"]

    decision_template = get_decision_prompt()
    prompt = decision_template.format(
        goal=goal,
        context=context,
    )

    try:
        result = llm_call(context=context, prompt=prompt, role="planner")
        decision = parse_json_from_llm(result, dict)
        if decision:
            decision_type = decision.get("type", "direct")
            subtasks = decision.get("subtasks", [])
            return {"type": decision_type, "subtasks": subtasks}
    except Exception as e:
        pass

    return {"type": "direct", "subtasks": []}


def parse_json_from_llm(text: str, expected_type: type) -> Optional[Any]:
    """
    从 LLM 输出中解析 JSON。
    expected_type: dict 或 list，控制返回类型
    """
    import re

    try:
        result = json.loads(text)
        if expected_type == dict:
            if isinstance(result, dict):
                return result
        elif expected_type == list:
            if isinstance(result, list):
                return result
            if isinstance(result, dict) and "subtasks" in result:
                return result["subtasks"]
    except json.JSONDecodeError:
        pass

    # 使用正则提取
    if expected_type == dict:
        pattern = r"\{[\s\S]*\}"
    else:
        pattern = r"\[[\s\S]*\]"

    m = re.search(pattern, text)
    if m:
        try:
            result = json.loads(m.group())
            if expected_type == dict:
                if isinstance(result, dict):
                    return result
            elif expected_type == list:
                if isinstance(result, list):
                    return result
                if isinstance(result, dict) and "subtasks" in result:
                    return result["subtasks"]
        except json.JSONDecodeError:
            pass
    return None


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------


def run_agent(goal_dir: str) -> None:
    goal_path = os.path.join(goal_dir, "goal.md")
    if not os.path.exists(goal_path):
        raise FileNotFoundError(f"goal.md not found in {goal_dir}")

    work_dir = os.path.dirname(goal_dir)
    logger = get_logger(work_dir)

    try:
        meta_agent(goal_dir, depth=0, display_index=1)
    except Exception as e:
        raise
