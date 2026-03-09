"""
执行器：execute_with_verification() 和 execute_decompose()
"""

import os
import re
import json
import subprocess
import sys
import hashlib
from typing import Dict, Any, List, Optional
from datetime import datetime

from logger import get_logger
from primitives import make_primitives
from deps import validate_dependencies, get_execution_levels, ValidationError
from prompts import get_code_generator_prompt, get_verifier_prompt


# 子进程执行 script 时的默认超时（秒）
SCRIPT_RUN_TIMEOUT = int(os.environ.get("SCRIPT_RUN_TIMEOUT", "600"))


# ---------------------------------------------------------------------------
# 子任务名称工具
# ---------------------------------------------------------------------------


def sanitize_subtask_name(name: str) -> str:
    """
    清理 subtask 名称，确保可以作为有效目录名。
    只允许字母、数字、下划线、连字符以及 Unicode 字符（如中文）。
    """
    if not name:
        return f"subtask_{hashlib.md5(str(datetime.now()).encode()).hexdigest()[:8]}"

    name = str(name).strip().replace(" ", "_")
    name = re.sub(r'[\\/:*"<>|]', "", name)
    name = re.sub(r"^[_\-]+|[_\-]+$", "", name, flags=re.ASCII)

    if not name or not re.search(r"[a-zA-Z0-9_\-\u4e00-\u9fff]", name):
        name = f"subtask_{hashlib.md5(name.encode()).hexdigest()[:8]}"

    return name[:64]


# ---------------------------------------------------------------------------
# script 解析工具
# ---------------------------------------------------------------------------


def _strip_tool_markup(text: str) -> str:
    """去除模型误输出的 tool 标记"""
    text = re.sub(r"<tool_code>.*?</tool_code>", "", text, flags=re.DOTALL)
    text = re.sub(r"<tool\s+name=[^>]*>.*?</tool>", "", text, flags=re.DOTALL)
    return text


def parse_script(llm_output: str) -> str:
    """从 LLM 输出中提取 Python 脚本"""
    llm_output = _strip_tool_markup(llm_output)

    for pattern in [r"```python\n(.*?)```", r"```script\n(.*?)```", r"```\n(.*?)```"]:
        m = re.search(pattern, llm_output, re.DOTALL)
        if m:
            return m.group(1).strip()

    return llm_output.strip()


def parse_script_plan(llm_output: str) -> tuple:
    """
    从 LLM 输出中同时解析 script 和 plan。
    返回: (script, plan) 元组
    """
    llm_output = _strip_tool_markup(llm_output)

    script = ""
    for pattern in [r"```python\n(.*?)```", r"```script\n(.*?)```"]:
        m = re.search(pattern, llm_output, re.DOTALL)
        if m:
            script = m.group(1).strip()
            break

    plan = ""
    m = re.search(r"```plan\n(.*?)```", llm_output, re.DOTALL)
    if m:
        plan = m.group(1).strip()

    return script, plan


# ---------------------------------------------------------------------------
# verifier 解析工具
# ---------------------------------------------------------------------------


def parse_verifier_response(llm_output: str) -> dict:
    """
    解析 verifier LLM 的输出。
    新格式: {"direct_info": str, "indirect_files": list}
    """
    import re

    # 清理 markdown 代码块
    cleaned = llm_output.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned[7:] if cleaned.lower().startswith("```json") else cleaned[3:]
        if cleaned.rstrip().endswith("```"):
            cleaned = cleaned.rstrip()[:-3]
        cleaned = cleaned.strip()

    # 尝试解析清理后的 JSON
    try:
        result = json.loads(cleaned)
        if isinstance(result, dict):
            return {
                "direct_info": result.get("direct_info", ""),
                "indirect_files": result.get("indirect_files", []),
            }
    except json.JSONDecodeError:
        pass

    # fallback：从原始输出中提取 JSON
    json_match = re.search(r"\{[\s\S]*\}", llm_output)
    if json_match:
        try:
            result = json.loads(json_match.group())
            if isinstance(result, dict):
                return {
                    "direct_info": result.get("direct_info", ""),
                    "indirect_files": result.get("indirect_files", []),
                }
        except json.JSONDecodeError:
            pass

    return {
        "direct_info": llm_output,  # 如果解析失败，把原始输出当作直接信息
        "indirect_files": [],
    }


# ---------------------------------------------------------------------------
# script 执行
# ---------------------------------------------------------------------------


def execute_script(goal_dir: str, permissions: dict, logger) -> str:
    """
    在子进程中执行 script.py，隔离崩溃。
    返回完整的 stdout+stderr 控制台输出。
    """
    script_path = os.path.join(goal_dir, "script.py")
    if not os.path.exists(script_path):
        raise FileNotFoundError(f"Script not found: {script_path}")

    src_dir = os.path.dirname(os.path.abspath(__file__))
    runner = os.path.join(src_dir, "script_runner.py")
    goal_dir_abs = os.path.abspath(goal_dir)

    # 供子进程读取 permissions
    perm_path = os.path.join(goal_dir_abs, ".executor_permissions.json")
    try:
        with open(perm_path, "w", encoding="utf-8") as f:
            json.dump(permissions or {}, f, indent=2, ensure_ascii=False)
    except OSError:
        pass

    try:
        result = subprocess.run(
            [sys.executable, runner, goal_dir_abs],
            cwd=src_dir,
            capture_output=True,
            text=True,
            timeout=SCRIPT_RUN_TIMEOUT,
            env=os.environ.copy(),
        )
    except subprocess.TimeoutExpired as e:
        out = (e.stdout or b"").decode("utf-8", errors="replace") + (
            e.stderr or b""
        ).decode("utf-8", errors="replace")
        err_msg = f"Script timed out after {SCRIPT_RUN_TIMEOUT}s"
        raise RuntimeError(err_msg) from e

    console_output = result.stdout + ("\n" + result.stderr if result.stderr else "")

    if result.returncode != 0:
        raise RuntimeError(
            f"Script exited with code {result.returncode}. Console output: {console_output[:500]}"
        )

    logger.log_trace(kind="script_executed", node=goal_dir)
    return console_output


# ---------------------------------------------------------------------------
# 核心执行：直接执行模式
# ---------------------------------------------------------------------------


def execute_with_verification(
    goal_dir: str, goal: str, context: str, permissions: dict, logger, depth: int = 0
) -> dict:
    """
    直接执行模式。
    - 执行一次 script
    - 调用 verifier 提取 direct_info 和 indirect_files
    - 返回包含提取信息的字典
    """
    primitives = make_primitives(goal_dir, permissions, logger)
    llm_call = primitives["llm_call"]

    # 生成 script
    code_gen_template = get_code_generator_prompt()
    prompt = code_gen_template.format(
        original_goal=goal,
        current_goal=goal,
        context=context,
        error_hint="",
        goal_dir=goal_dir,
        HISTORY_BLOCK="",
    )

    script_plan_content = llm_call(
        context=[goal, context],
        prompt=prompt,
        role="coder",
    )

    script, plan = parse_script_plan(script_plan_content)
    if not script:
        script = parse_script(script_plan_content)

    # 写入 script.py
    script_path = os.path.join(goal_dir, "script.py")
    with open(script_path, "w", encoding="utf-8") as f:
        f.write(script)

    logger.log_trace(kind="script_generated", node=goal_dir)

    # 执行 script
    observation = ""
    try:
        console_output = execute_script(goal_dir, permissions, logger)
        observation = console_output
    except Exception as e:
        observation = f"Execution failed: {type(e).__name__}: {e}"

    # 提取信息（不再做 pass/fail 判断）
    verifier_template = get_verifier_prompt()
    verifier_prompt = verifier_template.format(
        original_goal=goal,
        plan=plan or "No plan provided",
        script=script,
        console_output=observation,
    )

    verifier_response = llm_call(
        context=[goal, plan or "", script, observation],
        prompt=verifier_prompt,
        role="verifier",
    )

    verification = parse_verifier_response(verifier_response)
    raw_indirect = verification.get("indirect_files", [])

    # 将相对路径转为以 goal_dir 为基准的绝对路径
    indirect_files_abs = []
    for p in raw_indirect:
        if isinstance(p, str) and p.strip():
            if os.path.isabs(p):
                indirect_files_abs.append(os.path.normpath(p))
            else:
                indirect_files_abs.append(
                    os.path.normpath(os.path.join(goal_dir, p))
                )

    # 返回包含直接信息和间接文件的信息字典
    return {
        "observation": observation,
        "direct_info": verification.get("direct_info", ""),
        "indirect_files": indirect_files_abs,
    }


def write_results(goal_dir: str, observation: str) -> None:
    """根节点写入 results.md"""
    results_path = os.path.join(goal_dir, "results.md")
    with open(results_path, "w", encoding="utf-8") as f:
        f.write(f"# Result\n\n{observation}")


def append_to_parent_context(
    parent_dir: str,
    subtask_name: str,
    direct_info: str,
    indirect_files: Optional[List[str]] = None,
) -> None:
    """
    把子节点的直接信息和间接文件追加到父节点的 context.md。
    按子任务名称加标题追加，保持信息完整性。
    写入前逐行去重，避免冗余信息累积。

    Args:
        parent_dir: 父节点目录
        subtask_name: 子任务名称
        direct_info: verifier 提取的直接信息
        indirect_files: verifier 识别的间接文件路径列表
    """
    context_path = os.path.join(parent_dir, "context.md")

    if not direct_info and not indirect_files:
        return

    # 读取已有 context，逐行去重
    existing_lines: set = set()
    if os.path.exists(context_path):
        with open(context_path, "r", encoding="utf-8") as f:
            for line in f:
                stripped = line.strip()
                if stripped:
                    existing_lines.add(stripped)

    # 构建新内容
    new_lines = []

    # 写入直接信息，去除已存在的行
    if direct_info:
        for line in direct_info.splitlines():
            stripped = line.strip()
            if stripped and stripped not in existing_lines:
                new_lines.append(line)
                existing_lines.add(stripped)  # 防止同一段落内重复

    # 写入间接文件的 <<read>> 块
    if indirect_files:
        for file_path in indirect_files:
            read_block = f"<<read>> {file_path} <<read/>>"
            if read_block not in existing_lines:
                new_lines.append(read_block)
                existing_lines.add(read_block)

    if not new_lines:
        return

    with open(context_path, "a", encoding="utf-8") as f:
        f.write(f"\n\n# From: {subtask_name}\n")
        for line in new_lines:
            f.write(line + "\n")


# ---------------------------------------------------------------------------
# 分解执行
# ---------------------------------------------------------------------------


def execute_decompose(
    goal_dir: str,
    goal: str,
    subtasks: List[Dict[str, Any]],
    depth: int,
    permissions: dict,
    logger,
) -> None:
    """
    分解执行模式：
    1. 创建子节点目录（带数字前缀），写 goal.md
    2. 拓扑排序，分层串行执行
    3. 每个子节点完成后，立即把 observation 追加到父节点 context.md
    """
    from agent import meta_agent

    # 生成子任务名（带数字前缀）并更新 depends_on
    name_mapping: Dict[str, str] = {}
    for idx, subtask in enumerate(subtasks, start=1):
        original = subtask.get("name", "")
        prefixed = f"{idx}_{sanitize_subtask_name(original)}"
        name_mapping[original] = prefixed
        subtask["name"] = prefixed

    for subtask in subtasks:
        if "depends_on" in subtask:
            subtask["depends_on"] = [
                name_mapping.get(dep, dep) for dep in subtask["depends_on"]
            ]

    # 依赖校验
    validated_tasks = validate_dependencies(subtasks)

    # 创建子节点目录
    for subtask in validated_tasks:
        subdir = os.path.join(goal_dir, subtask["name"])
        os.makedirs(subdir, exist_ok=True)

        with open(os.path.join(subdir, "goal.md"), "w", encoding="utf-8") as f:
            f.write(subtask["description"])

    # 按拓扑序逐层执行
    levels = get_execution_levels(validated_tasks)

    for level_tasks in levels:
        for task_idx, task in enumerate(level_tasks):
            subdir = os.path.join(goal_dir, task["name"])
            # 子任务执行后，其 observation 会在 meta_agent 末尾写入父节点 context.md
            # 无需在此处额外调用 append_to_parent_context
            meta_agent(subdir, depth + 1, display_index=task_idx + 1)
