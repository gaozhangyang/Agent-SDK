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
from primitives import make_primitives, MAX_RETRY
from deps import validate_dependencies, get_execution_levels, ValidationError
from prompts import get_code_generator_prompt, get_verifier_prompt


# 子进程执行 script 时的默认超时（秒）
SCRIPT_RUN_TIMEOUT = int(os.environ.get("SCRIPT_RUN_TIMEOUT", "600"))

# 最大验证循环次数（纯容错，不用于探索）
MAX_VERIFY_RETRY = int(os.environ.get("MAX_VERIFY_RETRY", "2"))


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
    解析 verifier 输出。期望格式: {"pass": bool, "feedback": str}
    revised_goal 已移除，verifier 只做 pass/fail 判断。
    """
    cleaned = llm_output.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-z]*\n?", "", cleaned).rstrip("`").strip()

    for text in [cleaned, llm_output]:
        try:
            result = json.loads(text)
            if isinstance(result, dict) and "pass" in result:
                return {
                    "pass": bool(result.get("pass", False)),
                    "feedback": result.get("feedback", ""),
                }
        except json.JSONDecodeError:
            pass

        m = re.search(r"\{[\s\S]*\}", text)
        if m:
            try:
                result = json.loads(m.group())
                if isinstance(result, dict) and "pass" in result:
                    return {
                        "pass": bool(result.get("pass", False)),
                        "feedback": result.get("feedback", ""),
                    }
            except json.JSONDecodeError:
                pass

    return {
        "pass": False,
        "feedback": f"Failed to parse verifier response: {llm_output[:200]}",
    }


# ---------------------------------------------------------------------------
# results.md 读写工具
# ---------------------------------------------------------------------------

def _results_text_format(
    status: str,
    result_or_reason: str,
    console: Optional[str] = None,
    observations: Optional[str] = None,
) -> str:
    """生成控制台风格 results.md：首行 status，其余为可读区块"""
    lines = [f"status: {status}", ""]
    if result_or_reason:
        lines += ["--- result ---", result_or_reason.strip(), ""]
    if observations and observations.strip():
        lines += ["--- observations ---", observations.strip(), ""]
    if console and console.strip():
        lines += ["--- console ---", console.strip()]
    return "\n".join(lines)


def parse_results_content(content: str) -> Dict[str, Any]:
    """
    解析 results.md，兼容新（首行 status + 区块）与旧（JSON）格式。
    """
    content = content.strip()

    # 旧格式：JSON
    if content.startswith("{"):
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            pass

    lines = content.split("\n")
    out: Dict[str, Any] = {}

    if lines and lines[0].startswith("status:"):
        out["status"] = lines[0].split(":", 1)[1].strip()

    current_section = None
    for line in lines[1:]:
        stripped = line.strip()
        if stripped == "--- result ---":
            current_section = "result"
        elif stripped == "--- console ---":
            current_section = "console"
        elif stripped == "--- observations ---":
            current_section = "observations"
        elif stripped in ("--- merged results ---",):
            current_section = None  # merged 区块内容不单独解析
        elif current_section:
            out[current_section] = out.get(current_section, "") + line + "\n"

    for key in ("result", "console", "observations"):
        if key in out:
            out[key] = out[key].strip()

    return out


def write_results_completed(
    goal_dir: str,
    result: str,
    console: Optional[str] = None,
    observations: Optional[str] = None,
) -> None:
    """写入 completed 状态的结果"""
    results_path = os.path.join(goal_dir, "results.md")
    if os.path.exists(results_path):
        os.remove(results_path)
    with open(results_path, "w", encoding="utf-8") as f:
        f.write(_results_text_format("completed", result, console, observations))


def write_results_escalated(
    goal_dir: str,
    reason: str,
    error_ref: Optional[str] = None,
    console: Optional[str] = None,
) -> None:
    """
    写入 escalated 状态的结果。
    如果之前已是 completed，不覆盖。
    """
    results_path = os.path.join(goal_dir, "results.md")

    if os.path.exists(results_path):
        try:
            with open(results_path, "r", encoding="utf-8") as f:
                data = parse_results_content(f.read())
            if data.get("status") == "completed":
                return
        except Exception:
            pass

    reason_line = reason
    if error_ref:
        reason_line += f"\n(error_ref: {error_ref})"

    with open(results_path, "w", encoding="utf-8") as f:
        f.write(_results_text_format("escalated", reason_line, console))

    update_meta_status(goal_dir, "failed")


def _merge_console_into_results(results_path: str, console: str) -> None:
    """把控制台输出追加进已有的 results.md"""
    if not console.strip():
        return
    try:
        with open(results_path, "r", encoding="utf-8") as f:
            data = parse_results_content(f.read())
        with open(results_path, "w", encoding="utf-8") as f:
            f.write(_results_text_format(
                data.get("status", "completed"),
                data.get("result", ""),
                console,
                data.get("observations", ""),
            ))
    except OSError:
        pass


def update_meta_status(goal_dir: str, status: str) -> None:
    """更新 meta.json 的状态"""
    meta_path = os.path.join(goal_dir, "meta.json")
    if not os.path.exists(meta_path):
        return
    with open(meta_path, "r", encoding="utf-8") as f:
        meta = json.load(f)
    meta["status"] = status
    if status == "completed":
        meta["completed_at"] = datetime.now().isoformat()
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)


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
        out = (e.stdout or "") + (e.stderr or "")
        err_msg = f"Script timed out after {SCRIPT_RUN_TIMEOUT}s"
        write_results_escalated(goal_dir, err_msg, console=out)
        raise RuntimeError(err_msg) from e

    console_output = result.stdout + ("\n" + result.stderr if result.stderr else "")

    if result.returncode != 0:
        write_results_escalated(
            goal_dir,
            f"Exit code {result.returncode}",
            console=console_output,
        )
        raise RuntimeError(
            f"Script exited with code {result.returncode}. See results.md (console) for details."
        )

    logger.log_trace(kind="script_executed", node=goal_dir)
    return console_output


# ---------------------------------------------------------------------------
# 核心执行：带验证循环的直接执行
# ---------------------------------------------------------------------------

def execute_with_verification(
    goal_dir: str, goal: str, context: str, permissions: dict, logger, depth: int = 0
) -> None:
    """
    直接执行模式，带容错验证循环（马尔可夫结构）。

    循环的唯一用途是处理偶发错误（网络超时、文件权限等）。
    "信息不足"类问题应在决策阶段通过分解解决，不在此处重试。

    历史只保留上一时刻：last_script、last_feedback。
    """
    primitives = make_primitives(goal_dir, permissions, logger)
    llm_call = primitives["llm_call"]

    last_script, last_feedback = "", ""

    for attempt in range(MAX_VERIFY_RETRY):
        # 历史块：只包含上一时刻，最小化 context
        history_block = ""
        if last_script:
            history_block = (
                f"\n# === Previous attempt ===\n"
                f"Script:\n```\n{last_script}\n```\n"
                f"Feedback: {last_feedback}\n\n"
                f"IMPORTANT: Make MINIMAL changes to fix only what's necessary.\n"
            )

        error_hint_block = (
            f"\nError/feedback from previous attempt:\n{last_feedback}"
            if last_feedback else ""
        )

        code_gen_template = get_code_generator_prompt()
        prompt = code_gen_template.format(
            original_goal=goal,
            current_goal=goal,
            context=context,
            error_hint=error_hint_block,
            goal_dir=goal_dir,
            HISTORY_BLOCK=history_block,
        )

        try:
            script_plan_content = llm_call(
                context=[goal, context, last_feedback, last_script],
                prompt=prompt,
                role="coder",
            )

            script, plan = parse_script_plan(script_plan_content)
            if not script:
                script = parse_script(script_plan_content)

            # 写入 script.py（带尝试编号的备份，方便调试）
            script_path = os.path.join(goal_dir, "script.py")
            with open(script_path, "w", encoding="utf-8") as f:
                f.write(script)
            backup_path = os.path.join(goal_dir, f"script_attempt_{attempt + 1}.py")
            with open(backup_path, "w", encoding="utf-8") as f:
                f.write(script)

            logger.log_trace(kind="script_generated", node=goal_dir, attempt=attempt + 1)

            # 执行
            console_output = execute_script(goal_dir, permissions, logger)

            # 读取执行结果
            results_path = os.path.join(goal_dir, "results.md")
            execution_result = ""
            if os.path.exists(results_path):
                with open(results_path, "r", encoding="utf-8") as f:
                    execution_result = f.read()
            else:
                execution_result = console_output

            # 验证（只做 pass/fail，不修订 goal）
            verifier_template = get_verifier_prompt()
            verifier_prompt = verifier_template.format(
                original_goal=goal,
                plan=plan or "No plan provided",
                script=script,
                console_output=execution_result,
            )

            verifier_response = llm_call(
                context=[goal, plan or "", script, execution_result],
                prompt=verifier_prompt,
                role="verifier",
            )

            verification = parse_verifier_response(verifier_response)

            if verification.get("pass", False):
                if os.path.exists(results_path):
                    _merge_console_into_results(results_path, console_output)
                else:
                    write_results_completed(
                        goal_dir, "Script completed with verification", console=console_output
                    )
                logger.log_trace(kind="verification_passed", node=goal_dir, attempt=attempt + 1)
                return

            # 验证失败，更新上一时刻
            last_feedback = verification.get("feedback", "Verification failed")
            last_script = script

            logger.log_trace(
                kind="verification_failed",
                node=goal_dir,
                attempt=attempt + 1,
                feedback=last_feedback,
            )

        except Exception as e:
            last_feedback = str(e)
            logger.log_trace(
                kind="execution_error", node=goal_dir, attempt=attempt + 1, error=str(e)
            )

    # 达到最大重试次数
    write_results_escalated(
        goal_dir, f"Verification failed after {MAX_VERIFY_RETRY} attempts"
    )
    raise RuntimeError(f"Verification failed after {MAX_VERIFY_RETRY} attempts")


# ---------------------------------------------------------------------------
# 分解执行
# ---------------------------------------------------------------------------


def _append_observations_to_parent_context(goal_dir: str, subtask_name: str) -> None:
    """
    把子节点的 OBSERVATIONS 追加到父节点的 context.md。
    兄弟节点之间不直接通信，通过父节点 context.md 中转，实现纯父子信息流。
    写入前逐行去重，避免冗余信息累积。
    """
    subdir = os.path.join(goal_dir, subtask_name)
    results_path = os.path.join(subdir, "results.md")
    context_path = os.path.join(goal_dir, "context.md")

    if not os.path.exists(results_path):
        return

    with open(results_path, "r", encoding="utf-8") as f:
        data = parse_results_content(f.read())

    observations = data.get("observations", "").strip()
    if not observations:
        return

    # 读取已有 context，逐行去重，避免冗余信息累积
    existing_lines: set = set()
    if os.path.exists(context_path):
        with open(context_path, "r", encoding="utf-8") as f:
            existing_lines = {line.strip() for line in f if line.strip()}

    new_lines = [
        line for line in observations.splitlines()
        if line.strip() and line.strip() not in existing_lines
    ]
    if not new_lines:
        return

    with open(context_path, "a", encoding="utf-8") as f:
        f.write(f"\n\n# From: {subtask_name}\n" + "\n".join(new_lines))


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
    1. 创建子节点目录（带数字前缀），写 goal.md 和 meta.json
    2. 拓扑排序，分层串行执行
    3. 每个子节点完成后，把 OBSERVATIONS 追加进父节点 context.md（父子信息流）
    4. 子节点失败时重试（最多 MAX_RETRY 次）
    5. 全部完成后 merge_results 合并子节点结果
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

        # decomposition_id 基于子节点自身 description 的 hash，粒度为单个子节点
        subtask_hash = hashlib.md5(subtask["description"].encode()).hexdigest()
        meta = {
            "goal_id": str(__import__("uuid").uuid4()),
            "parent_goal_id": None,
            "depth": depth + 1,
            "decomposition_id": subtask_hash,
            "status": "not_started",
            "retry_count": 0,
            "context_truncated": False,
            "created_at": datetime.now().isoformat(),
            "completed_at": None,
        }
        with open(os.path.join(subdir, "meta.json"), "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2, ensure_ascii=False)

    # 按拓扑序逐层执行
    levels = get_execution_levels(validated_tasks)

    for level_tasks in levels:
        for task_idx, task in enumerate(level_tasks):
            subdir = os.path.join(goal_dir, task["name"])
            meta_agent(subdir, depth + 1, display_index=task_idx + 1)
            # 子节点完成后立即把 OBSERVATIONS 注入父节点 context.md
            _append_observations_to_parent_context(goal_dir, task["name"])

        # 检查失败，按需重试
        for task in level_tasks:
            subdir = os.path.join(goal_dir, task["name"])
            results_path = os.path.join(subdir, "results.md")

            if not os.path.exists(results_path):
                continue

            with open(results_path, "r", encoding="utf-8") as f:
                status = parse_results_content(f.read()).get("status")

            if status != "escalated":
                continue

            meta_path = os.path.join(subdir, "meta.json")
            retry_count = 0
            if os.path.exists(meta_path):
                with open(meta_path, "r", encoding="utf-8") as f:
                    meta_data = json.load(f)
                retry_count = meta_data.get("retry_count", 0)

            if retry_count < MAX_RETRY:
                meta_data["retry_count"] = retry_count + 1
                with open(meta_path, "w", encoding="utf-8") as f:
                    json.dump(meta_data, f, indent=2, ensure_ascii=False)

                logger.log_trace(kind="subtask_retry", node=subdir, retry=retry_count + 1)
                meta_agent(subdir, depth + 1, display_index=None)
                _append_observations_to_parent_context(goal_dir, task["name"])
            else:
                logger.log_trace(kind="subtask_retry_exhausted", node=subdir)
                write_results_escalated(
                    goal_dir,
                    f"Subtask {task['name']} failed after {MAX_RETRY} retries",
                )
                return

    merge_results(goal_dir, validated_tasks, goal, logger)


def merge_results(
    goal_dir: str, subtasks: List[Dict[str, Any]], goal: str, logger
) -> None:
    """
    直接合并子节点的 result + observations，不调用 LLM，不向上传递 console。
    """
    merged_parts = []
    has_failure = False

    for subtask in subtasks:
        subdir = os.path.join(goal_dir, subtask["name"])
        results_path = os.path.join(subdir, "results.md")

        if not os.path.exists(results_path):
            continue

        with open(results_path, "r", encoding="utf-8") as f:
            data = parse_results_content(f.read())

        status = data.get("status", "unknown")
        if status in ("escalated", "failed"):
            has_failure = True

        part = f"## Subtask: {subtask['name']}\nStatus: {status}\n"
        if data.get("result"):
            part += f"\n--- result ---\n{data['result']}\n"
        if data.get("observations"):
            part += f"\n--- observations ---\n{data['observations']}\n"
        merged_parts.append(part)

    content = "status: completed\n\n--- merged results ---\n\n" + "\n\n".join(merged_parts)

    with open(os.path.join(goal_dir, "results.md"), "w", encoding="utf-8") as f:
        f.write(content)

    update_meta_status(goal_dir, "failed" if has_failure else "completed")
    logger.log_trace(kind="results_merged", node=goal_dir, subtask_count=len(subtasks))