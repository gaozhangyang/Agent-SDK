"""
Meta-Agent 核心递归函数
"""

import os
import json
import uuid
from datetime import datetime
from typing import Dict, Any, Optional

from logger import get_logger, reset_logger
from permissions import load_permissions
from probe import probe
from executor import execute_direct, execute_decompose, write_results_escalated
from deps import validate_dependencies, ValidationError
from recovery import recover
from prompts import get_decision_prompt, get_decomposer_prompt

# 环境变量配置
MAX_DEPTH = int(os.environ.get("MAX_DEPTH", "4"))
MAX_RETRY = int(os.environ.get("MAX_RETRY", "3"))

# 默认 meta
DEFAULT_META = {
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
    副作用：写 context.md、script.py、error.md、meta.json、全局记录
    display_index: 当前层内的序号（1-based），用于终端显示，便于调试
    """
    # 初始化 logger
    work_dir = os.path.dirname(goal_dir)
    logger = get_logger(work_dir)

    # 显示用标签：有编号时为 "1. goal_name"，否则为 goal_name
    goal_name = os.path.basename(goal_dir.rstrip(os.sep))
    display_label = f"{display_index}. {goal_name}" if display_index is not None else goal_name

    # 1. 读取 goal.md 和 meta.json
    goal = read_goal(goal_dir)
    meta = read_or_init_meta(goal_dir)

    # 更新 meta 中的深度
    meta["depth"] = depth
    write_meta(goal_dir, meta)

    # 2. 加载 permissions.json
    permissions = load_permissions(goal_dir)

    # 记录开始
    seq = logger.log_trace(
        kind="node_start", node=goal_dir, goal_id=meta.get("goal_id", ""), depth=depth
    )
    logger.log_terminal(seq, goal_dir, "📍", f"{display_label} 开始执行")

    # 检查深度限制
    context = ""
    if depth >= permissions.get("max_depth", MAX_DEPTH):
        # 深度限制，强制直接解决
        logger.log_trace(
            kind="depth_limit",
            node=goal_dir,
            depth=depth,
            max_depth=permissions.get("max_depth", MAX_DEPTH),
        )
        decision_type = "direct"
    else:
        # 3. probe()：理解任务形状
        try:
            context = probe(goal_dir, goal, permissions, logger)
            meta["context_truncated"] = os.path.exists(
                os.path.join(goal_dir, "context.md")
            )
            write_meta(goal_dir, meta)
        except Exception as e:
            logger.log_trace(kind="probe_error", node=goal_dir, error=str(e))
            # probe 失败，继续执行
            context = ""

        # 4. llm_call 决策：direct or decompose
        decision_type = make_decision(context, goal, permissions, logger, goal_dir)

    # 更新状态为 running
    meta["status"] = "running"
    write_meta(goal_dir, meta)

    # 5a/5b 执行
    try:
        if decision_type == "direct":
            execute_direct(goal_dir, goal, context, permissions, logger, depth)
        else:
            # decompose 需要先获取子任务列表
            subtasks = get_subtasks(context, goal, permissions, logger, goal_dir)

            if not subtasks:
                # 无法分解，回退到直接执行
                logger.log_trace(kind="decompose_fallback", node=goal_dir)
                execute_direct(goal_dir, goal, context, permissions, logger, depth)
            else:
                execute_decompose(goal_dir, goal, subtasks, depth, permissions, logger)

        # 记录完成
        logger.log_trace(kind="node_completed", node=goal_dir)
        logger.log_terminal(seq, goal_dir, "📍", f"{display_label} 完成 → results.md")

    except Exception as e:
        logger.log_trace(kind="node_failed", node=goal_dir, error=str(e))
        logger.log_terminal(seq, goal_dir, "⚠️", f"{display_label} 失败 → {str(e)[:50]}")

        # 写入 error.md
        error_path = os.path.join(goal_dir, "error.md")
        with open(error_path, "w", encoding="utf-8") as f:
            f.write(str(e))

        # 更新 meta
        meta["status"] = "failed"
        write_meta(goal_dir, meta)

        raise


def read_goal(goal_dir: str) -> str:
    """读取 goal.md"""
    goal_path = os.path.join(goal_dir, "goal.md")
    if not os.path.exists(goal_path):
        return ""

    with open(goal_path, "r", encoding="utf-8") as f:
        return f.read()


def read_or_init_meta(goal_dir: str) -> Dict[str, Any]:
    """读取或初始化 meta.json"""
    meta_path = os.path.join(goal_dir, "meta.json")

    if os.path.exists(meta_path):
        with open(meta_path, "r", encoding="utf-8") as f:
            return json.load(f)

    # 初始化默认 meta
    meta = DEFAULT_META.copy()
    meta["goal_id"] = str(uuid.uuid4())
    meta["created_at"] = datetime.now().isoformat()

    # 写入
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)

    return meta


def write_meta(goal_dir: str, meta: Dict[str, Any]) -> None:
    """写入 meta.json"""
    meta_path = os.path.join(goal_dir, "meta.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)


def make_decision(
    context: str, goal: str, permissions: dict, logger, node_dir: str
) -> str:
    """
    决策：直接解决还是分解
    """
    from primitives import make_primitives

    primitives = make_primitives(node_dir, permissions, logger)
    llm_call = primitives["llm_call"]

    # 加载外部 prompt 模板
    decision_template = get_decision_prompt()
    prompt = decision_template.format(goal=goal, context=context)

    try:
        result = llm_call(context=context, prompt=prompt)

        # 解析 JSON
        decision = parse_decision(result)

        if decision:
            return decision.get("type", "direct")

    except Exception as e:
        logger.log_trace(kind="decision_error", node=node_dir, error=str(e))

    # 默认直接执行
    return "direct"


def parse_decision(llm_output: str) -> Optional[Dict[str, Any]]:
    """解析决策 JSON"""
    import re

    # 尝试直接解析
    try:
        return json.loads(llm_output)
    except json.JSONDecodeError:
        pass

    # 尝试提取 JSON
    json_match = re.search(r"\{[\s\S]*\}", llm_output)
    if json_match:
        try:
            return json.loads(json_match.group())
        except json.JSONDecodeError:
            pass

    return None


def get_subtasks(
    context: str, goal: str, permissions: dict, logger, node_dir: str
) -> list:
    """
    获取子任务列表
    """
    import re
    from primitives import make_primitives

    def sanitize_name(name: str) -> str:
        """清理 subtask 名称，确保可以创建有效目录"""
        if not name:
            return ""
        name = str(name).strip()
        name = name.replace(" ", "_")
        name = re.sub(r"[^a-zA-Z0-9_\-]", "", name)
        name = re.sub(r"^[_\-]+|[_\-]+$", "", name)
        if len(name) > 64:
            name = name[:64]
        return name

    primitives = make_primitives(node_dir, permissions, logger)
    llm_call = primitives["llm_call"]

    # 加载外部 prompt 模板
    decomp_template = get_decomposer_prompt()
    prompt = decomp_template.format(goal=goal, context=context, dependency_error="")

    max_retries = 3

    for attempt in range(max_retries):
        try:
            result = llm_call(context=context, prompt=prompt)

            # 解析 JSON
            subtasks = parse_subtasks(result)

            if subtasks:
                # 清理所有 subtask 名称
                for subtask in subtasks:
                    original_name = subtask.get("name", "")
                    sanitized_name = sanitize_name(original_name)

                    # 如果清理后的名称为空，生成一个默认名称
                    if not sanitized_name:
                        sanitized_name = (
                            f"subtask_{attempt}_{hash(original_name) % 10000}"
                        )

                    subtask["name"] = sanitized_name

                    # 同时清理 depends_on 中的名称
                    if "depends_on" in subtask:
                        cleaned_deps = []
                        for dep in subtask["depends_on"]:
                            cleaned_dep = sanitize_name(dep)
                            if cleaned_dep:
                                cleaned_deps.append(cleaned_dep)
                        subtask["depends_on"] = cleaned_deps

                # 验证依赖
                try:
                    validated = validate_dependencies(subtasks)
                    return validated
                except ValidationError as e:
                    # 依赖校验失败，重新生成
                    logger.log_trace(
                        kind="subtasks_retry",
                        node=node_dir,
                        attempt=attempt + 1,
                        error=str(e),
                    )

                    # 重新加载 prompt 模板并注入错误信息
                    dependency_error = f"\n\nPrevious dependency validation failed: {str(e)}\nPlease fix the dependencies."
                    prompt = decomp_template.format(
                        goal=goal, context=context, dependency_error=dependency_error
                    )
                    continue

        except Exception as e:
            logger.log_trace(kind="subtasks_error", node=node_dir, error=str(e))

    # 全部失败，返回空列表
    return []


def parse_subtasks(llm_output: str) -> Optional[list]:
    """解析子任务列表"""
    import re

    # 尝试直接解析
    try:
        result = json.loads(llm_output)
        if isinstance(result, list):
            return result
        if isinstance(result, dict) and "subtasks" in result:
            return result["subtasks"]
    except json.JSONDecodeError:
        pass

    # 尝试提取数组
    array_match = re.search(r"\[[\s\S]*\]", llm_output)
    if array_match:
        try:
            result = json.loads(array_match.group())
            if isinstance(result, list):
                return result
        except json.JSONDecodeError:
            pass

    return None


def run_agent(goal_dir: str, recover_mode: bool = False) -> None:
    """
    运行 meta-agent 的入口函数
    """
    # 检查 goal.md 是否存在
    goal_path = os.path.join(goal_dir, "goal.md")
    if not os.path.exists(goal_path):
        raise FileNotFoundError(f"goal.md not found in {goal_dir}")

    # 初始化 logger
    work_dir = os.path.dirname(goal_dir)
    logger = get_logger(work_dir)

    logger.log_state("session_start", root=goal_dir, session_id=str(uuid.uuid4()))

    try:
        if recover_mode:
            # 恢复模式
            logger.log_state("session_recover", root=goal_dir)
            recover(goal_dir)
        else:
            # 正常执行
            meta_agent(goal_dir, depth=0, display_index=1)

        logger.log_state("session_complete", root=goal_dir)

    except Exception as e:
        logger.log_state("session_error", root=goal_dir, error=str(e))
        raise
