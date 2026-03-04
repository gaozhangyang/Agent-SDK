"""
执行器：execute_direct() 和 execute_decompose()
"""

import os
import re
import json
import subprocess
import hashlib
import concurrent.futures
from typing import Dict, Any, List, Optional
from datetime import datetime

from logger import get_logger
from primitives import make_primitives
from deps import validate_dependencies, get_execution_levels, ValidationError


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

    prompt = f"""Generate a Python script to solve this task.

Goal:
{goal}

Context:
{context}
{
        f'''
Error from previous attempt:
{error_hint}
'''
        if error_hint
        else ""
    }

You can use these primitives:
- read(path): Read file content
- write(path, content): Write file content
- bash(command): Execute shell command
- llm_call(context, prompt): Call LLM API

Write the results to {goal_dir}/results.md in JSON format:
{{"status": "completed", "result": "..."}}

If you cannot complete the task, write:
{{"status": "escalated", "reason": "...", "error_ref": "error.md"}}
"""

    try:
        script_content = llm_call(context=[goal, context, error_hint], prompt=prompt)

        # 解析 script 内容
        script = parse_script(script_content)

        # 写入 script.py
        script_path = os.path.join(goal_dir, "script.py")
        with open(script_path, "w", encoding="utf-8") as f:
            f.write(script)

        logger.log_trace(kind="script_generated", node=goal_dir)

        # 3. 确定性执行脚本
        execute_script(goal_dir, permissions, logger)

    except Exception as e:
        # 写入错误信息
        error_path = os.path.join(goal_dir, "error.md")
        with open(error_path, "w", encoding="utf-8") as f:
            f.write(str(e))

        # 更新 meta.json
        update_meta_status(goal_dir, "failed")

        raise


def parse_script(llm_output: str) -> str:
    """从 LLM 输出中解析出 Python 脚本"""
    import re

    # 检查是否包含 ```python 或 ``` 标记
    code_block_match = re.search(r"```python\n(.*?)```", llm_output, re.DOTALL)
    if code_block_match:
        return code_block_match.group(1)

    # 检查是否有其他代码块
    code_block_match = re.search(r"```\n(.*?)```", llm_output, re.DOTALL)
    if code_block_match:
        return code_block_match.group(1)

    # 没有代码块，返回整个输出
    return llm_output


def execute_script(goal_dir: str, permissions: dict, logger) -> None:
    """
    执行 script.py
    使用 exec() 在同进程执行
    """
    script_path = os.path.join(goal_dir, "script.py")

    if not os.path.exists(script_path):
        raise FileNotFoundError(f"Script not found: {script_path}")

    # 读取 script 内容
    with open(script_path, "r", encoding="utf-8") as f:
        script_content = f.read()

    # 创建执行上下文
    primitives = make_primitives(goal_dir, permissions, logger)

    # 添加内置函数
    exec_globals = {"__builtins__": __builtins__, **primitives}

    # 执行脚本
    try:
        exec(script_content, exec_globals)

        logger.log_trace(kind="script_executed", node=goal_dir)

    except Exception as e:
        # 捕获所有异常，写入 error.md
        error_path = os.path.join(goal_dir, "error.md")
        with open(error_path, "w", encoding="utf-8") as f:
            f.write(str(e))

        update_meta_status(goal_dir, "failed")

        raise


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
    3. 拓扑排序，得到执行层级（同层的可以并发）
    4. 逐层执行：同层内用 ThreadPoolExecutor 并发调用 meta_agent()
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

    # 4. 逐层执行
    for level_idx, level_tasks in enumerate(levels):
        # 同层并发执行
        with concurrent.futures.ThreadPoolExecutor(
            max_workers=len(level_tasks)
        ) as executor:
            futures = {}
            for task in level_tasks:
                subdir = os.path.join(goal_dir, task["name"])
                future = executor.submit(meta_agent, subdir, depth + 1)
                futures[future] = task["name"]

            # 等待所有任务完成
            for future in concurrent.futures.as_completed(futures):
                task_name = futures[future]
                try:
                    future.result()
                except Exception as e:
                    logger.log_trace(
                        kind="subtask_error",
                        node=goal_dir,
                        subtask=task_name,
                        error=str(e),
                    )

        # 5. 检查子节点状态
        for task in level_tasks:
            subdir = os.path.join(goal_dir, task["name"])
            results_path = os.path.join(subdir, "results.md")

            if os.path.exists(results_path):
                with open(results_path, "r", encoding="utf-8") as f:
                    results_content = f.read()

                # 检查是否是 escalated
                try:
                    results = json.loads(results_content)
                    if results.get("status") == "escalated":
                        # 写入当前的 escalated results.md
                        write_results_escalated(
                            goal_dir,
                            f"Subtask {task['name']} escalated",
                            os.path.join(task["name"], "error.md"),
                        )
                        return  # 停止执行
                except json.JSONDecodeError:
                    pass

    # 6. 聚合子节点结果
    aggregate_results(goal_dir, subtasks, goal, permissions, logger)


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
    prompt = f"""Generate a Python script to aggregate results from subtasks and answer the original goal.

Original goal:
{goal}

Subtasks to aggregate:
{json.dumps(subtask_info, indent=2, ensure_ascii=False)}

The script should:
1. Read each subtask's results.md file
2. Call llm_call() to synthesize all results into a final answer
3. Write the final result to {goal_dir}/results.md in JSON format:
   {{"status": "completed", "result": "..."}}

You can use these primitives:
- read(path): Read file content
- write(path, content): Write file content
- bash(command): Execute shell command
- llm_call(context, prompt): Call LLM API
"""

    try:
        script_content = llm_call(context=[goal], prompt=prompt)

        # 解析 script 内容
        script = parse_script(script_content)

        # 写入 script.py
        script_path = os.path.join(goal_dir, "script.py")
        with open(script_path, "w", encoding="utf-8") as f:
            f.write(script)

        logger.log_trace(kind="script_generated", node=goal_dir, note="aggregate")

        # 2. 执行 script.py（聚合逻辑）
        execute_script(goal_dir, permissions, logger)

        # 检查 results.md 是否成功写入
        results_path = os.path.join(goal_dir, "results.md")
        if not os.path.exists(results_path):
            # 如果 script.py 没有写入 results，手动写入一个默认结果
            write_results_completed(goal_dir, "Aggregation completed via script.py")

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


def write_results_completed(goal_dir: str, result: str) -> None:
    """写入 completed 状态的结果"""
    results_path = os.path.join(goal_dir, "results.md")
    if os.path.exists(results_path):
        os.remove(results_path)

    with open(results_path, "w", encoding="utf-8") as f:
        json.dump(
            {"status": "completed", "result": result}, f, indent=2, ensure_ascii=False
        )


def write_results_escalated(goal_dir: str, reason: str, error_ref: str = None) -> None:
    """写入 escalated 状态的结果"""
    results_path = os.path.join(goal_dir, "results.md")
    if os.path.exists(results_path):
        os.remove(results_path)

    data = {"status": "escalated", "reason": reason}
    if error_ref:
        data["error_ref"] = error_ref

    with open(results_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

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
