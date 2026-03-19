"""
执行器：direct/decompose/finalize。
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime
from typing import Any, Dict, List, Optional

from agent_config import load_agent_config
from deps import get_execution_levels, validate_dependencies
from primitives import MAX_RETRY, make_primitives
from prompts import get_code_generator_prompt, get_observer_prompt


SCRIPT_RUN_TIMEOUT = int(os.environ.get("SCRIPT_RUN_TIMEOUT", "600"))


def sanitize_subtask_name(name: str) -> str:
    if not name:
        return f"subtask_{hashlib.md5(str(datetime.now()).encode()).hexdigest()[:8]}"
    name = str(name).strip().replace(" ", "_")
    name = re.sub(r'[\\/:*"<>|]', "", name)
    name = re.sub(r"^[_\-]+|[_\-]+$", "", name, flags=re.ASCII)
    if not name or not re.search(r"[a-zA-Z0-9_\-\u4e00-\u9fff]", name):
        name = f"subtask_{hashlib.md5(name.encode()).hexdigest()[:8]}"
    return name[:64]


def parse_script(script_content: str) -> str:
    cleaned = re.sub(r"<tool_code>.*?</tool_code>", "", script_content, flags=re.DOTALL)
    cleaned = re.sub(r"<tool\s+name=[^>]*>.*?</tool>", "", cleaned, flags=re.DOTALL)
    for pattern in (r"```python\n(.*?)\n```", r"```script\n(.*?)\n```"):
        match = re.search(pattern, cleaned, re.DOTALL)
        if match:
            return match.group(1).strip()
    return cleaned.strip()


def parse_observer_response(llm_output: str) -> dict:
    cleaned = llm_output.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned[7:] if cleaned.lower().startswith("```json") else cleaned[3:]
        cleaned = cleaned.rstrip()
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()

    for payload in (cleaned, _extract_json_object(llm_output)):
        if not payload:
            continue
        try:
            parsed = json.loads(payload)
            if isinstance(parsed, dict):
                return {
                    "status": parsed.get("status", "partial"),
                    "summary": parsed.get("summary", ""),
                    "direct_info": parsed.get("direct_info", ""),
                    "indirect_files": parsed.get("indirect_files", []),
                    "open_questions": parsed.get("open_questions", []),
                    "recommended_next_action": parsed.get(
                        "recommended_next_action", "finish"
                    ),
                }
        except json.JSONDecodeError:
            continue

    return {
        "status": "partial",
        "summary": "",
        "direct_info": llm_output,
        "indirect_files": [],
        "open_questions": [],
        "recommended_next_action": "finish",
    }


def execute_script(goal_dir: str, permissions: dict, logger) -> str:
    script_path = os.path.join(goal_dir, "script.py")
    if not os.path.exists(script_path):
        raise FileNotFoundError(f"Script not found: {script_path}")

    runner = os.path.join(os.path.dirname(os.path.abspath(__file__)), "script_runner.py")
    goal_dir_abs = os.path.abspath(goal_dir)

    result = subprocess.run(
        [sys.executable, runner, goal_dir_abs],
        cwd=os.path.dirname(runner),
        capture_output=True,
        text=True,
        timeout=SCRIPT_RUN_TIMEOUT,
        env=os.environ.copy(),
    )

    console_output = result.stdout + ("\n" + result.stderr if result.stderr else "")
    if result.returncode != 0:
        raise RuntimeError(
            f"Script exited with code {result.returncode}. Console output: {console_output[:2000]}"
        )
    return console_output


def execute_with_verification(
    goal_dir: str, goal: str, context: str, permissions: dict, logger, depth: int = 0
) -> dict:
    primitives = make_primitives(goal_dir, permissions, logger)
    llm_call = primitives["llm_call"]
    code_gen_template = get_code_generator_prompt()
    observer_template = get_observer_prompt()

    last_error = ""
    attempts: List[Dict[str, Any]] = []
    max_attempts = max(1, min(MAX_RETRY, 3))

    for attempt in range(1, max_attempts + 1):
        prompt = code_gen_template.format(
            current_goal=goal,
            goal_dir=goal_dir,
            attempt=attempt,
            previous_error=last_error or "None",
        )
        script_content = llm_call(context=context, prompt=prompt, role="coder")
        script = parse_script(script_content)
        if not script:
            last_error = "Code generator returned an empty script."
            attempts.append({"attempt": attempt, "status": "failed", "error": last_error})
            continue

        script_path = os.path.join(goal_dir, "script.py")
        with open(script_path, "w", encoding="utf-8") as f:
            f.write(script)

        try:
            observation = execute_script(goal_dir, permissions, logger)
        except Exception as exc:
            observation = f"Execution failed: {type(exc).__name__}: {exc}"

        observer_prompt = observer_template.format(
            goal=goal,
            script=script,
            observation=observation,
        )
        observer_response = llm_call(
            context=context,
            prompt=observer_prompt,
            role="observer",
        )
        verification = parse_observer_response(observer_response)
        direct_info = verification.get("direct_info", "")
        status = verification.get("status", "partial")

        attempt_record = {
            "attempt": attempt,
            "status": status,
            "summary": verification.get("summary", ""),
            "observation": observation,
        }
        attempts.append(attempt_record)

        if status == "success":
            return {
                "observation": observation,
                "summary": verification.get("summary", "") or _make_summary(observation),
                "status": "success",
                "direct_info": direct_info,
                "indirect_files": _resolve_indirect_paths(
                    verification.get("indirect_files", []), goal_dir
                ),
                "open_questions": verification.get("open_questions", []),
                "recommended_next_action": verification.get(
                    "recommended_next_action", "finish"
                ),
                "retries": attempt - 1,
                "attempts": attempts,
            }

        last_error = direct_info or observation

    final_observation = attempts[-1]["observation"] if attempts else last_error
    return {
        "observation": final_observation,
        "summary": _make_summary(final_observation),
        "status": "failed",
        "direct_info": last_error or final_observation,
        "indirect_files": [],
        "open_questions": ["Execution did not reach a success state."],
        "recommended_next_action": "decompose",
        "retries": max(0, len(attempts) - 1),
        "attempts": attempts,
    }


def execute_decompose(
    goal_dir: str,
    goal: str,
    subtasks: List[Dict[str, Any]],
    depth: int,
    permissions: dict,
    logger,
) -> List[Dict[str, Any]]:
    from agent import meta_agent

    name_mapping: Dict[str, str] = {}
    for idx, subtask in enumerate(subtasks, start=1):
        original = subtask.get("name", f"subtask_{idx}")
        prefixed = f"{idx}_{sanitize_subtask_name(original)}"
        name_mapping[original] = prefixed
        subtask["name"] = prefixed

    for subtask in subtasks:
        subtask["depends_on"] = [
            name_mapping.get(dep, dep) for dep in subtask.get("depends_on", [])
        ]

    validated_tasks = validate_dependencies(subtasks)
    for task in validated_tasks:
        subdir = os.path.join(goal_dir, task["name"])
        os.makedirs(subdir, exist_ok=True)
        with open(os.path.join(subdir, "goal.md"), "w", encoding="utf-8") as f:
            f.write(task["description"])

    child_artifacts = []
    for level_tasks in get_execution_levels(validated_tasks):
        for index, task in enumerate(level_tasks, start=1):
            subdir = os.path.join(goal_dir, task["name"])
            child_artifact = meta_agent(subdir, depth + 1, display_index=index)
            child_artifacts.append(child_artifact)
    return child_artifacts


def write_results(goal_dir: str, artifact: Dict[str, Any]) -> None:
    results_path = os.path.join(goal_dir, "results.md")
    lines = [
        "# Result",
        "",
        f"- status: {artifact.get('status', 'unknown')}",
        f"- mode: {artifact.get('mode', 'unknown')}",
        "",
        artifact.get("summary", "").strip() or "No summary available.",
    ]

    child_summaries = artifact.get("child_summaries", [])
    if child_summaries:
        lines.extend(["", "## Child Summaries"])
        for child in child_summaries:
            lines.append(
                f"- {child.get('name', 'unknown')}: {child.get('status', 'unknown')} | {child.get('summary', '')}"
            )

    direct_info = artifact.get("direct_info", "").strip()
    if direct_info:
        lines.extend(["", "## Direct Info", "", direct_info])

    with open(results_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines).strip() + "\n")


def append_to_parent_context(
    parent_dir: str,
    subtask_name: str,
    artifact: Dict[str, Any],
    permissions: Optional[Dict[str, Any]] = None,
) -> None:
    permissions = permissions or {}
    context_path = os.path.join(parent_dir, "context.md")

    summary = artifact.get("summary", "").strip()
    direct_info = artifact.get("direct_info", "").strip()
    indirect_files = artifact.get("indirect_files", []) or []
    open_questions = artifact.get("open_questions", []) or []
    if not any((summary, direct_info, indirect_files, open_questions)):
        return

    block_lines = [
        "",
        "---",
        "",
        f"# From: {subtask_name}",
        f"status: {artifact.get('status', 'unknown')}",
        f"mode: {artifact.get('mode', 'unknown')}",
    ]
    if summary:
        block_lines.extend(["summary:", summary])
    if direct_info:
        block_lines.extend(["direct_info:", direct_info])
    if open_questions:
        block_lines.append("open_questions:")
        block_lines.extend(f"- {item}" for item in open_questions)
    if indirect_files:
        block_lines.append("indirect_files:")
        block_lines.extend(f"<<read>> {path} <<read/>>" for path in indirect_files)

    new_content = "\n".join(block_lines) + "\n"
    max_chars = int(
        load_agent_config(parent_dir).get(
            "context_max_chars", permissions.get("context_max_chars", 800000)
        )
    )

    existing = ""
    if os.path.exists(context_path):
        with open(context_path, "r", encoding="utf-8") as f:
            existing = f.read()

    combined = existing + new_content
    if len(combined) > max_chars:
        trimmed = combined[-max_chars:]
        combined = "[Context tail retained due to character limit]\n\n" + trimmed

    with open(context_path, "w", encoding="utf-8") as f:
        f.write(combined)


def write_artifact(goal_dir: str, artifact: Dict[str, Any]) -> None:
    with open(os.path.join(goal_dir, "artifact.json"), "w", encoding="utf-8") as f:
        json.dump(artifact, f, indent=2, ensure_ascii=False)


def build_direct_artifact(goal_dir: str, goal: str, result: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "node": os.path.basename(goal_dir),
        "goal": goal,
        "mode": "direct",
        "status": result.get("status", "failed"),
        "summary": result.get("summary", ""),
        "observation": result.get("observation", ""),
        "direct_info": result.get("direct_info", ""),
        "indirect_files": result.get("indirect_files", []),
        "open_questions": result.get("open_questions", []),
        "recommended_next_action": result.get("recommended_next_action", "finish"),
        "retries": result.get("retries", 0),
        "attempts": result.get("attempts", []),
    }


def build_decompose_artifact(
    goal_dir: str, goal: str, child_artifacts: List[Dict[str, Any]]
) -> Dict[str, Any]:
    status = "success" if child_artifacts and all(
        child.get("status") == "success" for child in child_artifacts
    ) else "partial"
    if child_artifacts and any(child.get("status") == "failed" for child in child_artifacts):
        status = "failed"

    summary_parts = [
        f"{child.get('node', 'unknown')}: {child.get('status', 'unknown')} - {child.get('summary', '').strip()}"
        for child in child_artifacts
    ]
    return {
        "node": os.path.basename(goal_dir),
        "goal": goal,
        "mode": "decompose",
        "status": status,
        "summary": "\n".join(summary_parts) if summary_parts else "No child tasks were generated.",
        "direct_info": "",
        "indirect_files": [],
        "open_questions": [],
        "recommended_next_action": "finish" if status == "success" else "direct_retry",
        "children": [
            os.path.join(goal_dir, child.get("node", "")) for child in child_artifacts
        ],
        "child_summaries": [
            {
                "name": child.get("node", "unknown"),
                "status": child.get("status", "unknown"),
                "summary": child.get("summary", ""),
            }
            for child in child_artifacts
        ],
    }


def _resolve_indirect_paths(paths: List[str], base_dir: str) -> List[str]:
    resolved = []
    for path in paths:
        if not isinstance(path, str) or not path.strip():
            continue
        resolved.append(
            os.path.normpath(path if os.path.isabs(path) else os.path.join(base_dir, path))
        )
    return resolved


def _extract_json_object(text: str) -> str:
    match = re.search(r"\{[\s\S]*\}", text)
    return match.group(0) if match else ""


def _make_summary(observation: str) -> str:
    stripped = observation.strip()
    if not stripped:
        return "No observation produced."
    return stripped[:500]
