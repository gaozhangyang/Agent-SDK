"""
Prompt 加载模块
提供从 .md 文件加载 prompt 的功能
"""

import os
from typing import Optional

# 获取 prompts 目录的路径
PROMPTS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "prompts")


def load_prompt(prompt_name: str) -> str:
    """
    从 .md 文件加载 prompt

    Args:
        prompt_name: prompt 文件名（不含 .md 后缀）

    Returns:
        prompt 内容字符串

    Raises:
        FileNotFoundError: 如果 prompt 文件不存在
    """
    prompt_path = os.path.join(PROMPTS_DIR, f"{prompt_name}.md")

    if not os.path.exists(prompt_path):
        raise FileNotFoundError(f"Prompt file not found: {prompt_path}")

    with open(prompt_path, "r", encoding="utf-8") as f:
        return f.read()


def get_system_prompt() -> str:
    """获取系统级 prompt"""
    return load_prompt("system_prompt")


def get_code_generator_prompt() -> str:
    """获取代码生成 prompt 模板"""
    return load_prompt("code_generator")


def get_aggregator_prompt() -> str:
    """获取结果聚合 prompt 模板"""
    return load_prompt("aggregator")


def get_decision_prompt() -> str:
    """获取决策 prompt 模板"""
    return load_prompt("decision")


def get_decomposer_prompt() -> str:
    """获取任务分解 prompt 模板"""
    return load_prompt("decomposer")


def get_file_probe_prompt() -> str:
    """获取文件探测 prompt 模板"""
    return load_prompt("file_probe")
