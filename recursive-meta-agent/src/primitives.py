"""
四个原语实现：read, write, bash, llm_call
作为函数注入 script.py 的 exec 上下文
"""

import os
import subprocess
import json
from pathlib import Path
from typing import Union, List, Optional

# 全局配置，从环境变量读取
LLM_MODEL = os.environ.get("LLM_MODEL", "gpt-4")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1")

# 默认配置
DEFAULT_MAX_OUTPUT_LENGTH = 102400
DEFAULT_CONTEXT_BUDGET = {"total": 200000, "reservedOutput": 4000}
MAX_DEPTH = int(os.environ.get("MAX_DEPTH", "4"))
MAX_RETRY = int(os.environ.get("MAX_RETRY", "3"))


def make_primitives(node_dir: str, permissions: dict, logger) -> dict:
    """
    返回四个原语的字典，注入 script.py 的 exec 上下文。
    script.py 直接调用 read / write / bash / llm_call，不需要 import。
    """

    # 获取节点目录的绝对路径
    node_dir_abs = os.path.abspath(node_dir)

    # 获取工作区根目录
    work_dir = os.path.dirname(node_dir_abs)
    agent_dir = os.path.join(work_dir, ".agent")

    # 从权限配置获取限制
    max_output_length = permissions.get("max_output_length", DEFAULT_MAX_OUTPUT_LENGTH)
    context_budget = permissions.get("context_budget", DEFAULT_CONTEXT_BUDGET)

    def check_read_permission(path: str) -> bool:
        """检查读权限"""
        path_abs = os.path.abspath(path)

        # 获取允许的读取路径列表
        allowed_read = permissions.get("read", [])

        # 默认允许读取当前节点目录和父目录
        if not allowed_read:
            # 默认权限：可以读当前目录、.agent目录、父目录
            if (
                path_abs.startswith(node_dir_abs)
                or path_abs.startswith(agent_dir)
                or node_dir_abs.startswith(path_abs)
            ):
                return True
            return False

        # 检查路径是否在白名单
        for allowed in allowed_read:
            allowed_abs = os.path.abspath(os.path.join(node_dir_abs, allowed))
            if (
                path_abs.startswith(allowed_abs.rstrip("/") + "/")
                or path_abs == allowed_abs
            ):
                return True

        return False

    def check_write_permission(path: str) -> bool:
        """检查写权限"""
        path_abs = os.path.abspath(path)

        # 获取允许的写入路径列表
        allowed_write = permissions.get("write", [])

        if not allowed_write:
            # 默认权限：只能写当前节点目录
            if path_abs.startswith(node_dir_abs):
                return True
            return False

        # 检查路径是否在白名单
        for allowed in allowed_write:
            allowed_abs = os.path.abspath(os.path.join(node_dir_abs, allowed))
            if (
                path_abs.startswith(allowed_abs.rstrip("/") + "/")
                or path_abs == allowed_abs
            ):
                return True

        return False

    def read(path: str) -> str:
        """
        读取文件内容
        权限校验：跨节点只读，路径必须在白名单内
        """
        path_abs = os.path.abspath(path)

        if not check_read_permission(path_abs):
            raise PermissionError(f"Read permission denied: {path}")

        if not os.path.exists(path_abs):
            raise FileNotFoundError(f"File not found: {path}")

        with open(path_abs, "r", encoding="utf-8") as f:
            return f.read()

    def write(path: str, content: str) -> None:
        """
        写入文件内容
        权限校验：默认只能写当前节点目录
        写入文件，目录不存在时自动创建
        """
        path_abs = os.path.abspath(path)

        if not check_write_permission(path_abs):
            raise PermissionError(f"Write permission denied: {path}")

        # 确保目录存在
        dir_path = os.path.dirname(path_abs)
        os.makedirs(dir_path, exist_ok=True)

        with open(path_abs, "w", encoding="utf-8") as f:
            f.write(content)

    def bash(command: str) -> str:
        """
        执行 shell 命令，捕获 stdout + stderr
        输出超过 maxOutputLength 时截断并标记 truncated
        """
        # 记录命令执行
        logger.log_trace(
            kind="bash",
            node=node_dir,
            command=command[:200],  # 截断记录
        )

        try:
            result = subprocess.run(
                command, shell=True, capture_output=True, text=True, timeout=300
            )
            output = result.stdout + result.stderr

            # 检查输出长度
            truncated = False
            if len(output) > max_output_length:
                output = output[:max_output_length]
                truncated = True

            # 添加截断标记
            if truncated:
                output += "\n\n[Output truncated due to length]"

            return output

        except subprocess.TimeoutExpired:
            return f"Command timed out after 300 seconds"
        except Exception as e:
            return f"Command execution error: {str(e)}"

    def llm_call(context: Union[str, List[str]], prompt: str) -> str:
        """
        调用 LLM API
        context 是字符串或字符串列表，列表时自动拼接
        超出 token 预算时优先截断低优先级 context，不静默丢弃
        调用前后写 trace.jsonl（kind: llm_call，记录 token 数）
        """
        # 动态读取环境变量，确保使用最新的配置
        llm_model = os.environ.get("LLM_MODEL", "gpt-4")
        llm_api_key = os.environ.get("LLM_API_KEY", "")
        llm_base_url = os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1")

        # 处理 context
        if isinstance(context, list):
            context_str = "\n\n---\n\n".join(context)
        else:
            context_str = context

        # 估算 token 数 (简单估算：约 4 字符 = 1 token)
        context_tokens = len(context_str) // 4
        prompt_tokens = len(prompt) // 4

        total_tokens = context_tokens + prompt_tokens
        budget = context_budget.get("total", DEFAULT_CONTEXT_BUDGET["total"])
        reserved = context_budget.get(
            "reservedOutput", DEFAULT_CONTEXT_BUDGET["reservedOutput"]
        )

        # 如果超出预算，截断 context
        if total_tokens > budget - reserved:
            # 保留 prompt，截断 context
            allowed_context_tokens = budget - reserved - prompt_tokens
            if allowed_context_tokens > 0:
                allowed_chars = allowed_context_tokens * 4
                context_str = context_str[:allowed_chars]
                context_str += "\n\n[Context truncated due to token budget]"

        # 准备 API 请求
        if not llm_api_key:
            raise ValueError("LLM_API_KEY not set in environment variables")

        # 记录调用
        seq = logger.log_trace(
            kind="llm_call",
            node=node_dir,
            context_tokens=context_tokens,
            prompt_tokens=prompt_tokens,
        )

        try:
            from openai import OpenAI

            # 创建 OpenAI 客户端
            client = OpenAI(
                base_url=llm_base_url,
                api_key=llm_api_key,
            )

            # 调用 LLM
            response = client.chat.completions.create(
                model=llm_model,
                messages=[
                    {
                        "role": "system",
                        "content": "You are a helpful assistant.",
                    },
                    {
                        "role": "user",
                        "content": f"Context:\n{context_str}\n\n---\n\nPrompt:\n{prompt}",
                    },
                ],
                temperature=0.7,
                max_tokens=4096,
            )

            output = response.choices[0].message.content
            if output is None:
                raise ValueError("LLM returned empty response")

            # 记录响应
            output_tokens = len(output) // 4
            logger.log_trace(
                kind="llm_call_response",
                node=node_dir,
                seq=seq,
                output_tokens=output_tokens,
            )

            return output

        except Exception as e:
            logger.log_trace(
                kind="llm_call_error", node=node_dir, seq=seq, error=str(e)
            )
            raise

    return {"read": read, "write": write, "bash": bash, "llm_call": llm_call}
