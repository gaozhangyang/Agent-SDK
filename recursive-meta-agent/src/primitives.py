"""
LLM 调用封装。
"""

from __future__ import annotations

import os
from typing import List, Union

from agent_config import build_agent_context, load_agent_config
from prompts import get_system_prompt


DEFAULT_CONTEXT_BUDGET = {"total": 200000, "reserved_output": 4000}
MAX_RETRY = int(os.environ.get("MAX_RETRY", "3"))


def make_primitives(node_dir: str, permissions: dict, logger) -> dict:
    agent_config = load_agent_config(node_dir)
    context_budget = agent_config.get(
        "context_budget",
        permissions.get("context_budget", DEFAULT_CONTEXT_BUDGET),
    )

    def llm_call(
        context: Union[str, List[str]], prompt: str, role: str = "default"
    ) -> str:
        if isinstance(context, list):
            context_str = "\n\n---\n\n".join(context)
        else:
            context_str = context

        context_tokens = len(context_str) // 4
        prompt_tokens = len(prompt) // 4
        total_tokens = context_tokens + prompt_tokens
        budget = int(context_budget.get("total", DEFAULT_CONTEXT_BUDGET["total"]))
        reserved = int(
            context_budget.get(
                "reserved_output", DEFAULT_CONTEXT_BUDGET["reserved_output"]
            )
        )

        if total_tokens > budget - reserved:
            allowed_context_tokens = budget - reserved - prompt_tokens
            if allowed_context_tokens > 0:
                context_str = context_str[: allowed_context_tokens * 4]
                context_str += "\n\n[Context truncated due to token budget]"

        llm_model = os.environ.get("LLM_MODEL", "MiniMax-M2.5")
        llm_api_key = os.environ.get("LLM_API_KEY", "")
        llm_base_url = os.environ.get("LLM_BASE_URL", "http://127.0.0.1:3888/v1/")

        if not llm_api_key:
            raise ValueError("LLM_API_KEY not set in environment variables")

        system_prompt = get_system_prompt()
        agent_context = build_agent_context(agent_config, role)
        role_hint = _get_role_hint(role)
        if agent_context:
            system_prompt = f"{system_prompt}\n\n# AGENT Runtime Context\n{agent_context}"
        if role_hint:
            system_prompt = f"{system_prompt}\n\n# Current Role\n{role_hint}"

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
            temperature=0.2,
            max_tokens=4096,
        )

        output = response.choices[0].message.content
        if output is None:
            raise ValueError("LLM returned empty response")
        return output

    return {"llm_call": llm_call}


def _get_role_hint(role: str) -> str:
    role_hints = {
        "default": "General reasoning. Prefer deterministic, structured output.",
        "planner": "Return only the task decision JSON. Choose decomposition whenever required information is missing.",
        "coder": "Return only a Python code block. Prefer minimal edits and explicit file paths.",
        "observer": "Return only JSON matching the observer schema.",
    }
    return role_hints.get(role, role_hints["default"])
