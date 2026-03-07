"""
LLM 调用封装：供 meta-agent 内部使用（决策、分解、代码生成、验证）。
script.py 使用标准 Python（open、subprocess 等），不注入此类原语。
"""

import os
from typing import Union, List

# 默认配置
DEFAULT_CONTEXT_BUDGET = {"total": 200000, "reservedOutput": 4000}
MAX_RETRY = int(os.environ.get("MAX_RETRY", "3"))


def make_primitives(node_dir: str, permissions: dict, logger) -> dict:
    """
    返回供 meta-agent 内部使用的 llm_call。
    agent.py / executor.py 通过 primitives["llm_call"] 调用 LLM（决策、分解、生成、验证）。
    """
    node_dir_abs = os.path.abspath(node_dir)
    context_budget = permissions.get("context_budget", DEFAULT_CONTEXT_BUDGET)

    def llm_call(
        context: Union[str, List[str]], prompt: str, role: str = "default"
    ) -> str:
        """
        调用 LLM API。
        role: default / coder / verifier / planner
        """
        system_prompts = {
            "default": "You are a helpful assistant.",
            "coder": "You are a code generator. Output ONLY the requested code block. Do not include any explanatory text, introductions, or conclusions outside the code block.",
            "verifier": "You are a verifier. Output ONLY valid JSON. Strictly follow the schema. Do not include any explanatory text outside the JSON.",
            "planner": "You are a planner. Output clear, structured decisions. Be concise and analytical.",
        }
        system_prompt = system_prompts.get(role, system_prompts["default"])

        llm_model = os.environ.get("LLM_MODEL", "MiniMax-M2.5")
        llm_api_key = os.environ.get("LLM_API_KEY", "")
        llm_base_url = os.environ.get("LLM_BASE_URL", "http://35.220.164.252:3888/v1/")

        if isinstance(context, list):
            context_str = "\n\n---\n\n".join(context)
        else:
            context_str = context

        context_tokens = len(context_str) // 4
        prompt_tokens = len(prompt) // 4
        total_tokens = context_tokens + prompt_tokens
        budget = context_budget.get("total", DEFAULT_CONTEXT_BUDGET["total"])
        reserved = context_budget.get(
            "reservedOutput", DEFAULT_CONTEXT_BUDGET["reservedOutput"]
        )

        if total_tokens > budget - reserved:
            allowed_context_tokens = budget - reserved - prompt_tokens
            if allowed_context_tokens > 0:
                allowed_chars = allowed_context_tokens * 4
                context_str = context_str[:allowed_chars]
                context_str += "\n\n[Context truncated due to token budget]"

        if not llm_api_key:
            raise ValueError("LLM_API_KEY not set in environment variables")

        seq = logger.log_trace(
            kind="llm_call",
            node=node_dir,
            context_tokens=context_tokens,
            prompt_tokens=prompt_tokens,
        )

        try:
            from openai import OpenAI

            client = OpenAI(base_url=llm_base_url, api_key=llm_api_key)
            response = client.chat.completions.create(
                model=llm_model,
                messages=[
                    {"role": "system", "content": system_prompt},
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

    return {"llm_call": llm_call}
