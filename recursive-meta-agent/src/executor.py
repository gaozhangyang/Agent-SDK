"""
执行器：execute_direct() 和 execute_decompose()
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
from prompts import (
    get_code_generator_prompt,
    get_aggregator_prompt,
    get_verifier_prompt,
    get_revise_prompt,
)


def sanitize_subtask_name(name: str) -> str:
    """
    清理和验证 subtask 名称，确保它可以作为有效的目录名。

    规则：
    - 只允许字母、数字、下划线、连字符（ASCII）
    - 移除或替换无效字符（空格、斜杠、冒号等）
    - 确保名称不为空
    - 截断过长名称
    """
    if not name:
        return f"subtask_{hashlib.md5(str(datetime.now()).encode()).hexdigest()[:8]}"

    # 转换为字符串并移除首尾空白
    name = str(name).strip()

    # 替换空格为下划线
    name = name.replace(" ", "_")

    # 只保留字母、数字、下划线、连字符（ASCII字符）
    # 同时保留Unicode字符（如中文、日文等）
    # 移除斜杠、冒号、反斜杠等在文件系统中可能有问题的字符
    name = re.sub(r'[\\/:*"<>|]', "", name)

    # 移除前导/尾随的非字母数字字符（保留Unicode字符）
    name = re.sub(r"^[_\-]+|[_\-]+$", "", name, flags=re.ASCII)

    # 如果名称为空，生成一个基于原始名称哈希的名称
    if not name or not re.search(r"[a-zA-Z0-9_\-\u4e00-\u9fff]", name):
        name = f"subtask_{hashlib.md5(name.encode()).hexdigest()[:8]}"

    # 截断到合理长度（避免超长路径问题）
    if len(name) > 64:
        name = name[:64]

    return name


def execute_direct(
    goal_dir: str, goal: str, context: str, permissions: dict, logger, depth: int = 0
) -> None:
    """
    直接解决模式
    1. 检查是否有 error.md，注入错误信息
    2. 生成 script.py
    3. 执行 script.py
    """

    # 1. 如有失败现场，注入 error 信息
    error_hint = ""
    error_path = os.path.join(goal_dir, "error.md")
    if os.path.exists(error_path):
        with open(error_path, "r", encoding="utf-8") as f:
            error_hint = f.read()

    # 2. 生成 script.py
    primitives = make_primitives(goal_dir, permissions, logger)
    llm_call = primitives["llm_call"]

    # 加载代码生成 prompt（已合并 system + 任务说明，含输出格式与 skills/tools 鼓励）
    code_gen_template = get_code_generator_prompt()
    error_hint_block = (
        f"""
Error from previous attempt:
{error_hint}
"""
        if error_hint
        else ""
    )
    prompt = code_gen_template.format(
        goal=goal, context=context, error_hint=error_hint_block, goal_dir=goal_dir
    )

    try:
        script_content = llm_call(context=[goal, context, error_hint], prompt=prompt)

        # 解析 script 内容
        script = parse_script(script_content)

        # 写入 script.py
        script_path = os.path.join(goal_dir, "script.py")
        with open(script_path, "w", encoding="utf-8") as f:
            f.write(script)

        logger.log_trace(kind="script_generated", node=goal_dir)

        # 3. 确定性执行脚本，并捕获控制台输出
        console_output = execute_script(goal_dir, permissions, logger)

        # 将控制台输出合并进 results.md
        results_path = os.path.join(goal_dir, "results.md")
        if os.path.exists(results_path):
            _merge_console_into_results(results_path, console_output)
        else:
            write_results_completed(
                goal_dir,
                "Script completed without writing results.md",
                console=console_output,
            )

    except Exception as e:
        # 写入错误信息与 escalated 结果，保证节点总有“结果记录”
        error_path = os.path.join(goal_dir, "error.md")
        with open(error_path, "w", encoding="utf-8") as f:
            f.write(str(e))
        write_results_escalated(goal_dir, str(e), "error.md")
        raise


def parse_script(llm_output: str) -> str:
    """从 LLM 输出中解析出 Python 脚本。若含 <tool_code> 等标记则先剥离再提取。"""
    import re

    # 若模型误输出了 tool 标记，先去掉整段 <tool_code>...</tool_code>，避免写入 script.py
    cleaned = re.sub(r"<tool_code>.*?</tool_code>", "", llm_output, flags=re.DOTALL)
    cleaned = re.sub(r"<tool\s+name=[^>]*>.*?</tool>", "", cleaned, flags=re.DOTALL)
    if cleaned.strip() != llm_output.strip():
        llm_output = cleaned

    # 检查是否包含 ```python 或 ``` 标记
    code_block_match = re.search(r"```python\n(.*?)```", llm_output, re.DOTALL)
    if code_block_match:
        return code_block_match.group(1).strip()

    code_block_match = re.search(r"```\n(.*?)```", llm_output, re.DOTALL)
    if code_block_match:
        return code_block_match.group(1).strip()

    # 没有代码块，返回整个输出（去除首尾空白）
    return llm_output.strip()


def parse_script_plan(llm_output: str) -> tuple:
    """
    从 LLM 输出中同时解析出 script 和 plan。
    期望输出格式包含 ```script 和 ```plan 部分。
    返回: (script, plan) 元组
    """
    import re

    # 清理 tool 标记
    cleaned = re.sub(r"<tool_code>.*?</tool_code>", "", llm_output, flags=re.DOTALL)
    cleaned = re.sub(r"<tool\s+name=[^>]*>.*?</tool>", "", cleaned, flags=re.DOTALL)
    if cleaned.strip() != llm_output.strip():
        llm_output = cleaned

    script = ""
    plan = ""

    # 提取 script
    script_match = re.search(r"```python\n(.*?)```", llm_output, re.DOTALL)
    if script_match:
        script = script_match.group(1).strip()
    else:
        script_match = re.search(r"```script\n(.*?)```", llm_output, re.DOTALL)
        if script_match:
            script = script_match.group(1).strip()

    # 提取 plan
    plan_match = re.search(r"```plan\n(.*?)```", llm_output, re.DOTALL)
    if plan_match:
        plan = plan_match.group(1).strip()

    return script, plan


def parse_verifier_response(llm_output: str) -> dict:
    """
    解析 verifier LLM 的输出。
    期望格式: {"pass": true/false, "feedback": "..."}
    返回: {"pass": bool, "feedback": str}
    """
    import re

    # 尝试直接解析 JSON
    try:
        result = json.loads(llm_output)
        if isinstance(result, dict) and "pass" in result:
            return result
    except json.JSONDecodeError:
        pass

    # 尝试提取 JSON
    json_match = re.search(r"\{[\s\S]*\}", llm_output)
    if json_match:
        try:
            result = json.loads(json_match.group())
            if isinstance(result, dict) and "pass" in result:
                return result
        except json.JSONDecodeError:
            pass

    # 默认返回失败
    return {
        "pass": False,
        "feedback": f"Failed to parse verifier response: {llm_output[:200]}",
    }


def parse_revise_response(llm_output: str) -> dict:
    """
    解析 revise LLM 的输出。
    期望格式: {"revised_goal": "..."} 或 {"revised_goal": null, "reason": "..."}
    返回: {"revised_goal": str or None, "reason": str}
    """
    import re

    # 尝试直接解析 JSON
    try:
        result = json.loads(llm_output)
        if isinstance(result, dict):
            return {
                "revised_goal": result.get("revised_goal"),
                "reason": result.get("reason", ""),
            }
    except json.JSONDecodeError:
        pass

    # 尝试提取 JSON
    json_match = re.search(r"\{[\s\S]*\}", llm_output)
    if json_match:
        try:
            result = json.loads(json_match.group())
            if isinstance(result, dict):
                return {
                    "revised_goal": result.get("revised_goal"),
                    "reason": result.get("reason", ""),
                }
        except json.JSONDecodeError:
            pass

    # 默认返回无需修订
    return {"revised_goal": None, "reason": "Failed to parse revise response"}


# 最大验证循环次数
MAX_VERIFY_RETRY = int(os.environ.get("MAX_VERIFY_RETRY", "3"))


def _build_history_block(history: list) -> str:
    """
    构建历史记录块，包含之前每次尝试的 script 和 feedback
    """
    if not history:
        return ""

    block = "\n# === History of previous attempts ===\n"
    for i, (script, feedback) in enumerate(history, 1):
        block += f"\n## Attempt {i}\n"
        block += f"Script:\n```script\n{script}\n```\n"
        block += f"Verification feedback: {feedback}\n"
    block += "\n# === End of history ===\n"
    block += "\nIMPORTANT: Based on the history above, make MINIMAL changes to fix only what's necessary. "
    block += "Do NOT rewrite the entire script - only fix the parts that caused the verification failure.\n"
    return block


def execute_with_verification(
    goal_dir: str, goal: str, context: str, permissions: dict, logger, depth: int = 0
) -> None:
    """
    带验证循环的直接执行模式。
    1. 生成 script 和 plan（通过 LLMCall），参考历史尝试
    2. 执行 script
    3. 验证结果（通过 verifier LLMCall）
    4. 如果验证失败，记录历史并重试（最多 MAX_VERIFY_RETRY 次）
    """
    primitives = make_primitives(goal_dir, permissions, logger)
    llm_call = primitives["llm_call"]

    current_goal = goal
    current_context = context
    error_hint = ""
    history = []  # 记录每次尝试的 (script, feedback)

    for attempt in range(MAX_VERIFY_RETRY):
        # 1. 构建历史记录块
        history_block = _build_history_block(history)

        # 2. 构建 prompt，包含历史信息
        error_hint_block = (
            f"\nError from previous attempt:\n{error_hint}" if error_hint else ""
        )

        code_gen_template = get_code_generator_prompt()
        prompt = code_gen_template.format(
            goal=current_goal,
            context=current_context,
            error_hint=error_hint_block,
            goal_dir=goal_dir,
            HISTORY_BLOCK=history_block,
        )

        try:
            script_plan_content = llm_call(
                context=[current_goal, current_context, error_hint, history_block],
                prompt=prompt,
            )

            # 解析 script 和 plan
            script, plan = parse_script_plan(script_plan_content)

            if not script:
                # 如果没有提取到 script，使用整个输出作为 script
                script = parse_script(script_plan_content)

            # 写入 script.py
            script_path = os.path.join(goal_dir, "script.py")
            with open(script_path, "w", encoding="utf-8") as f:
                f.write(script)

            # 写入 plan.md（如果存在）
            if plan:
                plan_path = os.path.join(goal_dir, "plan.md")
                with open(plan_path, "w", encoding="utf-8") as f:
                    f.write(plan)

            logger.log_trace(
                kind="script_generated", node=goal_dir, attempt=attempt + 1
            )

            # 3. 执行 script.py
            console_output = execute_script(goal_dir, permissions, logger)

            # 4. 验证结果
            results_path = os.path.join(goal_dir, "results.md")
            execution_result = ""
            if os.path.exists(results_path):
                with open(results_path, "r", encoding="utf-8") as f:
                    execution_result = f.read()
            else:
                execution_result = console_output

            # 调用 verifier
            verifier_template = get_verifier_prompt()
            verifier_prompt = verifier_template.format(
                plan=plan or "No plan provided",
                script=script,
                result=execution_result,
            )

            verifier_response = llm_call(
                context=[current_goal, plan or "", script, execution_result],
                prompt=verifier_prompt,
            )

            verification = parse_verifier_response(verifier_response)

            if verification.get("pass", False):
                # 验证通过，合并控制台输出到 results.md
                if os.path.exists(results_path):
                    _merge_console_into_results(results_path, console_output)
                else:
                    write_results_completed(
                        goal_dir,
                        "Script completed with verification",
                        console=console_output,
                    )
                logger.log_trace(
                    kind="verification_passed", node=goal_dir, attempt=attempt + 1
                )
                return

            # 验证失败，获取反馈
            feedback = verification.get("feedback", "Verification failed")
            logger.log_trace(
                kind="verification_failed",
                node=goal_dir,
                attempt=attempt + 1,
                feedback=feedback,
            )

            # 5. 记录到历史，然后尝试修订 goal
            history.append((script, feedback))

            # 6. 修订 goal
            revise_template = get_revise_prompt()
            revise_prompt = revise_template.format(goal=current_goal, feedback=feedback)

            revise_response = llm_call(
                context=[current_goal, feedback], prompt=revise_prompt
            )

            revise_result = parse_revise_response(revise_response)

            if revise_result.get("revised_goal"):
                # 更新 goal 并继续循环
                current_goal = revise_result["revised_goal"]
                goal_path = os.path.join(goal_dir, "goal.md")
                with open(goal_path, "w", encoding="utf-8") as f:
                    f.write(current_goal)

                error_hint = (
                    f"Verification feedback: {feedback}\n"
                    f"Revision reason: {revise_result.get('reason', '')}"
                )
                logger.log_trace(
                    kind="goal_revised",
                    node=goal_dir,
                    revised_goal=current_goal[:100],
                    reason=revise_result.get("reason", ""),
                )
            else:
                # goal 无需修订，但验证失败
                error_hint = f"Verification feedback: {feedback}"

        except Exception as e:
            # 执行过程中出现异常
            error_hint = str(e)
            logger.log_trace(
                kind="execution_error", node=goal_dir, attempt=attempt + 1, error=str(e)
            )

    # 达到最大重试次数，标记为失败
    error_path = os.path.join(goal_dir, "error.md")
    with open(error_path, "w", encoding="utf-8") as f:
        f.write(f"Verification failed after {MAX_VERIFY_RETRY} attempts")
    write_results_escalated(
        goal_dir,
        f"Verification failed after {MAX_VERIFY_RETRY} attempts",
        "error.md",
    )
    raise RuntimeError(f"Verification failed after {MAX_VERIFY_RETRY} attempts")


def merge_results(
    goal_dir: str, subtasks: List[Dict[str, Any]], goal: str, logger
) -> None:
    """
    分解模式下直接合并子节点结果，不再调用 LLM。
    读取所有子节点的 results.md，按顺序合并到一个结果文件中。
    """
    merged_results = []
    all_status = []

    for subtask in subtasks:
        subdir = os.path.join(goal_dir, subtask["name"])
        results_path = os.path.join(subdir, "results.md")

        if os.path.exists(results_path):
            with open(results_path, "r", encoding="utf-8") as f:
                content = f.read()

            results_data = parse_results_content(content)
            status = results_data.get("status", "unknown")
            all_status.append(status)

            merged_results.append(
                {
                    "subtask": subtask["name"],
                    "status": status,
                    "result": results_data.get("result", ""),
                    "console": results_data.get("console", ""),
                }
            )

    # 写入合并后的结果
    merged_content = f"status: completed\n\n--- merged results ---\n\n"

    for item in merged_results:
        merged_content += f"## Subtask: {item['subtask']}\n"
        merged_content += f"Status: {item['status']}\n\n"
        if item.get("result"):
            merged_content += f"--- result ---\n{item['result']}\n\n"
        if item.get("console"):
            merged_content += f"--- console ---\n{item['console']}\n\n"
        merged_content += "\n"

    results_path = os.path.join(goal_dir, "results.md")
    with open(results_path, "w", encoding="utf-8") as f:
        f.write(merged_content)

    # 检查是否有失败的任务
    if "escalated" in all_status or "failed" in all_status:
        update_meta_status(goal_dir, "failed")
    else:
        update_meta_status(goal_dir, "completed")

    logger.log_trace(kind="results_merged", node=goal_dir, subtask_count=len(subtasks))


# 子进程执行 script 时的默认超时（秒）
SCRIPT_RUN_TIMEOUT = int(os.environ.get("SCRIPT_RUN_TIMEOUT", "600"))


def execute_script(goal_dir: str, permissions: dict, logger) -> str:
    """
    在子进程中执行 script.py，子进程崩溃不会影响主进程。
    将子进程的 stdout/stderr 完整捕获并作为控制台结果返回（含报错信息）。
    返回: 控制台输出字符串（stdout + stderr）
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
        _write_script_failure(goal_dir, err_msg, out)
        raise RuntimeError(err_msg) from e

    stdout = result.stdout or ""
    stderr = result.stderr or ""
    console_output = stdout + ("\n" + stderr if stderr else "")

    if result.returncode != 0:
        _write_script_failure(
            goal_dir, f"Exit code {result.returncode}", console_output
        )
        raise RuntimeError(
            f"Script exited with code {result.returncode}. See error.md and results.md (console)."
        )

    logger.log_trace(kind="script_executed", node=goal_dir)
    return console_output


def _write_script_failure(goal_dir: str, message: str, console_output: str) -> None:
    """子进程失败时写 error.md 与 escalated results.md（含完整控制台输出）"""
    error_path = os.path.join(goal_dir, "error.md")
    with open(error_path, "w", encoding="utf-8") as f:
        f.write(message)
    write_results_escalated(goal_dir, message, "error.md", console=console_output)


def _results_text_format(
    status: str, result_or_reason: str, console: Optional[str] = None
) -> str:
    """生成控制台风格 results.md 正文：首行 status，其余为可读区块"""
    lines = [f"status: {status}", ""]
    if result_or_reason:
        lines.append("--- result ---")
        lines.append(result_or_reason.strip())
        lines.append("")
    if console and console.strip():
        lines.append("--- console ---")
        lines.append(console.strip())
    return "\n".join(lines)


def parse_results_content(content: str) -> Dict[str, Any]:
    """解析 results.md 内容，兼容新（首行 status + 区块）与旧（JSON）格式。供 recovery 等调用。"""
    content = content.strip()
    # 旧格式：整份 JSON
    if content.startswith("{"):
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            pass
    # 新格式：首行 status: xxx，随后 --- result --- / --- console ---
    lines = content.split("\n")
    out: Dict[str, Any] = {}
    if lines and lines[0].startswith("status:"):
        out["status"] = lines[0].split(":", 1)[1].strip()
    i = 1
    while i < len(lines):
        if lines[i].strip() == "--- result ---":
            i += 1
            block = []
            while i < len(lines) and lines[i].strip() != "--- console ---":
                block.append(lines[i])
                i += 1
            out["result"] = "\n".join(block).strip()
            # 兼容：escalated 时 reason = result；若有 (error_ref: xxx) 则拆出 error_ref
            if out.get("status") == "escalated" and out.get("result"):
                out["reason"] = out["result"].split("\n(error_ref:")[0].strip()
                if "(error_ref:" in out["result"]:
                    m = re.search(r"\(error_ref:\s*([^)]+)\)", out["result"])
                    if m:
                        out["error_ref"] = m.group(1).strip()
            continue
        if lines[i].strip() == "--- console ---":
            i += 1
            out["console"] = "\n".join(lines[i:]).strip()
            break
        i += 1
    return out


def _merge_console_into_results(results_path: str, console: str) -> None:
    """把控制台输出合并进已有的 results.md（新格式则追加 console 区块，旧 JSON 则转成新格式）"""
    if not console.strip():
        return
    try:
        with open(results_path, "r", encoding="utf-8") as f:
            content = f.read()
        data = parse_results_content(content)
        status = data.get("status", "completed")
        result = data.get("result", "")
        with open(results_path, "w", encoding="utf-8") as f:
            f.write(_results_text_format(status, result, console))
    except OSError:
        pass


def execute_decompose(
    goal_dir: str,
    goal: str,
    subtasks: List[Dict[str, Any]],
    depth: int,
    permissions: dict,
    logger,
) -> None:
    """
    分解执行模式
    1. 创建子节点目录，写 goal.md 和 meta.json
    2. validate_dependencies()
    3. 拓扑排序，得到执行层级
    4. 按拓扑序串行执行：逐层逐节点执行 meta_agent()
    5. 每层执行完后检查子节点 results.md 的 status
    6. 全部完成 → llm_call 聚合所有子节点 results.md → 写当前节点 results.md
    """
    from agent import meta_agent

    # 生成 decomposition_id
    decomposition_id = hashlib.md5(str(subtasks).encode()).hexdigest()

    # 1. 创建子节点目录
    # 首先清理所有 subtask 名称，确保它们是有效的目录名
    name_mapping = {}  # 原始名称 -> 清理后的名称
    for subtask in subtasks:
        original_name = subtask.get("name", "")
        sanitized_name = sanitize_subtask_name(original_name)
        name_mapping[original_name] = sanitized_name
        subtask["name"] = sanitized_name

    # 再次验证依赖（使用清理后的名称）
    try:
        validated_tasks = validate_dependencies(subtasks)
    except ValidationError as e:
        # 依赖校验失败，抛出错误让上层重新生成
        raise e

    # 创建子节点目录
    for subtask in subtasks:
        subdir = os.path.join(goal_dir, subtask["name"])
        os.makedirs(subdir, exist_ok=True)

        # 写入 goal.md
        goal_path = os.path.join(subdir, "goal.md")
        with open(goal_path, "w", encoding="utf-8") as f:
            f.write(subtask["description"])

        # 写入 meta.json
        meta = {
            "goal_id": subtask.get("goal_id", ""),
            "parent_goal_id": None,
            "depth": depth + 1,
            "decomposition_id": decomposition_id,
            "status": "not_started",
            "retry_count": 0,
            "context_truncated": False,
            "created_at": datetime.now().isoformat(),
            "completed_at": None,
        }
        meta_path = os.path.join(subdir, "meta.json")
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2, ensure_ascii=False)

        # 写入 permissions.json（继承父节点权限，但做一些限制）
        child_permissions = {
            "read": permissions.get("read", []),
            "write": permissions.get("write", []),
            "bash": {
                "network": permissions.get("bash", {}).get("network", True),
                "delete": False,  # 子节点默认不允许删除
            },
            "max_depth": permissions.get("max_depth", 4),
            "max_output_length": permissions.get("max_output_length", 102400),
            "context_budget": permissions.get(
                "context_budget", {"total": 200000, "reservedOutput": 4000}
            ),
        }
        perm_path = os.path.join(subdir, "permissions.json")
        with open(perm_path, "w", encoding="utf-8") as f:
            json.dump(child_permissions, f, indent=2, ensure_ascii=False)

    # 2. 验证依赖
    try:
        validated_tasks = validate_dependencies(subtasks)
    except ValidationError as e:
        # 依赖校验失败，抛出错误让上层重新生成
        raise e

    # 3. 获取执行层级
    levels = get_execution_levels(validated_tasks)

    # 4. 按拓扑序逐层串行执行（每层内目标名前加序号，便于调试）
    for level_idx, level_tasks in enumerate(levels):
        for task_idx, task in enumerate(level_tasks):
            subdir = os.path.join(goal_dir, task["name"])
            meta_agent(subdir, depth + 1, display_index=task_idx + 1)

        # 5. 检查子节点状态
        for task in level_tasks:
            subdir = os.path.join(goal_dir, task["name"])
            results_path = os.path.join(subdir, "results.md")

            if os.path.exists(results_path):
                with open(results_path, "r", encoding="utf-8") as f:
                    results_content = f.read()

                # 检查是否是 escalated（兼容新/旧 results 格式）
                results = parse_results_content(results_content)
                if results.get("status") == "escalated":
                    # 写入当前的 escalated results.md
                    write_results_escalated(
                        goal_dir,
                        f"Subtask {task['name']} escalated",
                        os.path.join(task["name"], "error.md"),
                    )
                    return  # 停止执行

    # 6. 聚合子节点结果 - 使用 merge_results 直接合并，不再调用 LLM
    merge_results(goal_dir, subtasks, goal, logger)


def aggregate_results(
    goal_dir: str, subtasks: List[Dict[str, Any]], goal: str, permissions: dict, logger
) -> None:
    """
    聚合所有子节点 results.md
    1. 生成 script.py（负责读取子节点结果并调用 llm_call 聚合）
    2. 执行 script.py
    """
    primitives = make_primitives(goal_dir, permissions, logger)
    llm_call = primitives["llm_call"]

    # 收集子节点信息（名称和路径），供 script.py 使用
    subtask_info = []
    for subtask in subtasks:
        subdir = os.path.join(goal_dir, subtask["name"])
        results_path = os.path.join(subdir, "results.md")
        if os.path.exists(results_path):
            subtask_info.append({"name": subtask["name"], "results_path": results_path})

    # 1. 生成 script.py，让 LLM 生成聚合逻辑代码
    aggregator_template = get_aggregator_prompt()
    subtasks_info = json.dumps(subtask_info, indent=2, ensure_ascii=False)
    prompt = aggregator_template.format(
        goal=goal, subtasks_info=subtasks_info, goal_dir=goal_dir
    )

    try:
        script_content = llm_call(context=[goal], prompt=prompt)

        # 解析 script 内容
        script = parse_script(script_content)

        # 写入 script.py
        script_path = os.path.join(goal_dir, "script.py")
        with open(script_path, "w", encoding="utf-8") as f:
            f.write(script)

        logger.log_trace(kind="script_generated", node=goal_dir, note="aggregate")

        # 2. 执行 script.py（聚合逻辑），并合并控制台输出到 results.md
        console_output = execute_script(goal_dir, permissions, logger)
        results_path = os.path.join(goal_dir, "results.md")
        if os.path.exists(results_path):
            _merge_console_into_results(results_path, console_output)
        else:
            write_results_completed(
                goal_dir,
                "Aggregation completed via script.py",
                console=console_output,
            )

        # 更新 meta
        update_meta_status(goal_dir, "completed")

    except Exception as e:
        write_results_escalated(goal_dir, str(e), "error.md")


def parse_results(llm_output: str) -> Dict[str, Any]:
    """解析 LLM 输出的 results"""
    import re

    # 尝试直接解析 JSON
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

    # 返回默认格式
    return {"status": "completed", "result": llm_output}


def write_results_completed(
    goal_dir: str, result: str, console: Optional[str] = None
) -> None:
    """写入 completed 状态的结果（控制台风格：首行 status，随后 result / console 区块）"""
    results_path = os.path.join(goal_dir, "results.md")
    if os.path.exists(results_path):
        os.remove(results_path)
    with open(results_path, "w", encoding="utf-8") as f:
        f.write(_results_text_format("completed", result, console))


def write_results_escalated(
    goal_dir: str,
    reason: str,
    error_ref: Optional[str] = None,
    console: Optional[str] = None,
) -> None:
    """写入 escalated 状态的结果（控制台风格：首行 status，随后 reason / console 区块）"""
    results_path = os.path.join(goal_dir, "results.md")
    if os.path.exists(results_path):
        os.remove(results_path)
    reason_line = reason
    if error_ref:
        reason_line = reason_line + f"\n(error_ref: {error_ref})"
    with open(results_path, "w", encoding="utf-8") as f:
        f.write(_results_text_format("escalated", reason_line, console))
    update_meta_status(goal_dir, "failed")


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
