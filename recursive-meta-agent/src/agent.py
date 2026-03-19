"""
Meta-Agent 核心递归函数。
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, Optional

from agent_config import load_agent_config
from executor import (
    append_to_parent_context,
    build_decompose_artifact,
    build_direct_artifact,
    execute_decompose,
    execute_with_verification,
    write_artifact,
    write_results,
)
from logger import get_logger
from permissions import load_permissions
from probe import probe
from prompts import get_decision_prompt


MAX_DEPTH = int(os.environ.get("MAX_DEPTH", "4"))


def meta_agent(
    goal_dir: str,
    depth: int = 0,
    display_index: Optional[int] = None,
) -> Dict[str, Any]:
    work_dir = os.path.dirname(goal_dir)
    logger = get_logger(work_dir)
    goal = read_goal(goal_dir)
    permissions, permissions_dir = load_permissions(goal_dir)
    agent_config = load_agent_config(goal_dir)

    context = probe(goal_dir, goal, permissions, logger, depth, permissions_dir)

    decision = {"type": "direct", "subtasks": []}
    max_depth = min(
        int(permissions.get("max_depth", MAX_DEPTH)),
        int(agent_config.get("max_depth", MAX_DEPTH)),
    )
    if depth < max_depth:
        decision = make_decision(context, goal, permissions, logger, goal_dir)

    if decision["type"] == "decompose" and decision.get("subtasks"):
        child_artifacts = execute_decompose(
            goal_dir, goal, decision["subtasks"], depth, permissions, logger
        )
        artifact = build_decompose_artifact(goal_dir, goal, child_artifacts)
    else:
        result = execute_with_verification(goal_dir, goal, context, permissions, logger, depth)
        artifact = build_direct_artifact(goal_dir, goal, result)

    write_artifact(goal_dir, artifact)

    if depth == 0:
        write_results(goal_dir, artifact)
    else:
        append_to_parent_context(
            os.path.dirname(goal_dir), os.path.basename(goal_dir), artifact, permissions
        )

    return artifact


def read_goal(goal_dir: str) -> str:
    goal_path = os.path.join(goal_dir, "goal.md")
    if not os.path.exists(goal_path):
        return ""
    with open(goal_path, "r", encoding="utf-8") as f:
        return f.read()


def make_decision(
    context: str,
    goal: str,
    permissions: dict,
    logger,
    node_dir: str,
) -> dict:
    from primitives import make_primitives

    llm_call = make_primitives(node_dir, permissions, logger)["llm_call"]
    prompt = get_decision_prompt().format(goal=goal)

    try:
        result = llm_call(context=context, prompt=prompt, role="planner")
        parsed = parse_json_from_llm(result)
        if isinstance(parsed, dict) and parsed.get("type") in {"direct", "decompose"}:
            subtasks = parsed.get("subtasks", [])
            if not isinstance(subtasks, list):
                subtasks = []
            return {"type": parsed["type"], "subtasks": subtasks}
    except Exception:
        pass
    return {"type": "direct", "subtasks": []}


def parse_json_from_llm(text: str) -> Optional[Any]:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    import re

    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return None


def run_agent(goal_dir: str) -> None:
    goal_path = os.path.join(goal_dir, "goal.md")
    if not os.path.exists(goal_path):
        raise FileNotFoundError(f"goal.md not found in {goal_dir}")
    meta_agent(goal_dir, depth=0, display_index=1)
