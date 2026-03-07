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
    write_results_escalated,
    parse_results_content,
)
from deps import validate_dependencies, ValidationError
from recovery import recover
from prompts import get_decision_prompt, get_decomposer_prompt

MAX_DEPTH = int(os.environ.get("MAX_DEPTH", "4"))
MAX_RETRY = int(os.environ.get("MAX_RETRY", "3"))

DEFAULT_META: Dict[str, Any] = {
    "goal_id": "",
    "parent_goal_id": None,
    "depth": 0,
    "decomposition_id": "",
    "status": "not_started",
    "retry_count": 0,
    "context_truncated": False,
    "created_at": "",
    "completed_at": None,
}


def meta_agent(
    goal_dir: str, depth: int = 0, display_index: Optional[int] = None
) -> None:
    """
    输入：一个包含 goal.md 的目录
    输出：在该目录写入 results.md（completed 或 escalated）
    副作用：写 context.md、script.py、results.md、meta.json、全局记录
    display_index: 当前层内的序号（1-based），用于终端显示
    """
    work_dir = os.path.dirname(goal_dir)
    logger = get_logger(work_dir)

    goal_name = os.path.basename(goal_dir.rstrip(os.sep))
    display_label = f"{display_index}. {goal_name}" if display_index is not None else goal_name

    goal = _read_goal(goal_dir)
    meta = _read_or_init_meta(goal_dir)
    meta["depth"] = depth
    _write_meta(goal_dir, meta)

    permissions, permissions_dir = load_permissions(goal_dir)

    seq = logger.log_trace(
        kind="node_start", node=goal_dir, goal_id=meta.get("goal_id", ""), depth=depth
    )
    logger.log_terminal(seq, goal_dir, "📍", f"{display_label} 开始执行")

    context = ""

    # 深度限制 → 强制直接执行
    if depth >= permissions.get("max_depth", MAX_DEPTH):
        logger.log_trace(
            kind="depth_limit", node=goal_dir, depth=depth,
            max_depth=permissions.get("max_depth", MAX_DEPTH),
        )
        decision_type = "direct"
    else:
        # Probe：确定性操作，理解任务形状
        try:
            context = probe(goal_dir, goal, permissions, logger, depth, permissions_dir)
        except Exception as e:
            logger.log_trace(kind="probe_error", node=goal_dir, error=str(e))
            context = ""

        # 读取上次失败原因（如果有），注入决策
        previous_failure = _read_previous_failure(goal_dir)

        # 决策：direct or decompose
        decision_type = _make_decision(
            context, goal, permissions, logger, goal_dir, previous_failure
        )

    meta["status"] = "running"
    _write_meta(goal_dir, meta)

    try:
        if decision_type == "direct":
            execute_with_verification(goal_dir, goal, context, permissions, logger, depth)
        else:
            subtasks = _get_subtasks(context, goal, permissions, logger, goal_dir)
            if not subtasks:
                # 无法分解，回退到直接执行
                logger.log_trace(kind="decompose_fallback", node=goal_dir)
                execute_with_verification(goal_dir, goal, context, permissions, logger, depth)
            else:
                execute_decompose(goal_dir, goal, subtasks, depth, permissions, logger)

        logger.log_trace(kind="node_completed", node=goal_dir)
        logger.log_terminal(seq, goal_dir, "📍", f"{display_label} 完成 → results.md")

    except Exception as e:
        logger.log_trace(kind="node_failed", node=goal_dir, error=str(e))
        logger.log_terminal(seq, goal_dir, "⚠️", f"{display_label} 失败 → {str(e)[:50]}")
        write_results_escalated(goal_dir, str(e))
        meta["status"] = "failed"
        _write_meta(goal_dir, meta)
        raise


# ---------------------------------------------------------------------------
# 内部工具函数
# ---------------------------------------------------------------------------

def _read_goal(goal_dir: str) -> str:
    goal_path = os.path.join(goal_dir, "goal.md")
    if not os.path.exists(goal_path):
        return ""
    with open(goal_path, "r", encoding="utf-8") as f:
        return f.read()


def _read_or_init_meta(goal_dir: str) -> Dict[str, Any]:
    meta_path = os.path.join(goal_dir, "meta.json")
    if os.path.exists(meta_path):
        with open(meta_path, "r", encoding="utf-8") as f:
            return json.load(f)
    meta = DEFAULT_META.copy()
    meta["goal_id"] = str(uuid.uuid4())
    meta["created_at"] = datetime.now().isoformat()
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)
    return meta


def _write_meta(goal_dir: str, meta: Dict[str, Any]) -> None:
    meta_path = os.path.join(goal_dir, "meta.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)


def _read_previous_failure(goal_dir: str) -> str:
    """
    读取上次执行的失败原因（如果有）。
    只在 results.md 存在且 status 为 escalated 时返回非空字符串。
    这个信息会注入 decision prompt，让 LLM 知道上次为何失败，
    避免重试时做出同样的 direct 决策。
    """
    results_path = os.path.join(goal_dir, "results.md")
    if not os.path.exists(results_path):
        return ""
    try:
        with open(results_path, "r", encoding="utf-8") as f:
            content = f.read()
        data = parse_results_content(content)
        if data.get("status") == "escalated":
            reason = data.get("result", data.get("reason", ""))
            if reason:
                return f"# Previous attempt failed\nReason: {reason}"
    except Exception:
        pass
    return ""


def _make_decision(
    context: str,
    goal: str,
    permissions: dict,
    logger,
    node_dir: str,
    previous_failure: str = "",
) -> str:
    """LLM 决策：direct 还是 decompose。
    previous_failure 非空时注入 prompt，引导 LLM 避免重复错误。
    """
    from primitives import make_primitives

    primitives = make_primitives(node_dir, permissions, logger)
    llm_call = primitives["llm_call"]

    decision_template = get_decision_prompt()
    prompt = decision_template.format(
        goal=goal,
        context=context,
        previous_failure=previous_failure,
    )

    try:
        result = llm_call(context=context, prompt=prompt, role="planner")
        decision = _parse_json(result)
        if decision:
            return decision.get("type", "direct")
    except Exception as e:
        logger.log_trace(kind="decision_error", node=node_dir, error=str(e))

    return "direct"


def _get_subtasks(
    context: str, goal: str, permissions: dict, logger, node_dir: str
) -> list:
    """获取子任务列表，最多重试 3 次（依赖校验失败时重新生成）"""
    import re
    from primitives import make_primitives

    def _sanitize(name: str) -> str:
        name = str(name).strip().replace(" ", "_")
        name = re.sub(r"[^a-zA-Z0-9_\-]", "", name)
        name = re.sub(r"^[_\-]+|[_\-]+$", "", name)
        return name[:64] if name else ""

    primitives = make_primitives(node_dir, permissions, logger)
    llm_call = primitives["llm_call"]

    decomp_template = get_decomposer_prompt()
    dependency_error = ""

    for attempt in range(3):
        prompt = decomp_template.format(
            goal=goal, context=context, dependency_error=dependency_error
        )
        try:
            result = llm_call(context=context, prompt=prompt, role="planner")
            subtasks = _parse_subtasks(result)

            if not subtasks:
                continue

            # 清理名称
            for subtask in subtasks:
                original = subtask.get("name", "")
                clean = _sanitize(original)
                subtask["name"] = clean or f"subtask_{attempt}_{hash(original) % 10000}"
                if "depends_on" in subtask:
                    subtask["depends_on"] = [
                        d for dep in subtask["depends_on"]
                        if (d := _sanitize(dep))
                    ]

            # 依赖校验
            try:
                return validate_dependencies(subtasks)
            except ValidationError as e:
                dependency_error = f"\n\nPrevious dependency validation failed: {e}\nPlease fix."
                logger.log_trace(
                    kind="subtasks_retry", node=node_dir, attempt=attempt + 1, error=str(e)
                )

        except Exception as e:
            logger.log_trace(kind="subtasks_error", node=node_dir, error=str(e))

    return []


def _parse_json(text: str) -> Optional[Dict[str, Any]]:
    """尝试从 LLM 输出中解析 JSON 对象"""
    import re
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{[\s\S]*\}", text)
    if m:
        try:
            return json.loads(m.group())
        except json.JSONDecodeError:
            pass
    return None


def _parse_subtasks(text: str) -> Optional[list]:
    """尝试从 LLM 输出中解析子任务列表"""
    import re
    try:
        result = json.loads(text)
        if isinstance(result, list):
            return result
        if isinstance(result, dict) and "subtasks" in result:
            return result["subtasks"]
    except json.JSONDecodeError:
        pass
    m = re.search(r"\[[\s\S]*\]", text)
    if m:
        try:
            result = json.loads(m.group())
            if isinstance(result, list):
                return result
        except json.JSONDecodeError:
            pass
    return None


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------

def run_agent(goal_dir: str, recover_mode: bool = False) -> None:
    goal_path = os.path.join(goal_dir, "goal.md")
    if not os.path.exists(goal_path):
        raise FileNotFoundError(f"goal.md not found in {goal_dir}")

    work_dir = os.path.dirname(goal_dir)
    logger = get_logger(work_dir)
    logger.log_state("session_start", root=goal_dir, session_id=str(uuid.uuid4()))

    try:
        if recover_mode:
            logger.log_state("session_recover", root=goal_dir)
            recover(goal_dir)
        else:
            meta_agent(goal_dir, depth=0, display_index=1)
        logger.log_state("session_complete", root=goal_dir)
    except Exception as e:
        logger.log_state("session_error", root=goal_dir, error=str(e))
        raise