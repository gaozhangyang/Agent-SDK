"""
AGENT.md 配置解析与运行时注入。
"""

from __future__ import annotations

import ast
import os
import re
from dataclasses import dataclass
from typing import Any, Dict, Optional


DEFAULT_AGENT_CONFIG: Dict[str, Any] = {
    "max_output_length": 102400,
    "context_budget": {"total": 200000, "reserved_output": 4000},
    "context_max_chars": 800000,
    "max_depth": 4,
    "learned_patterns": "",
}


SECTION_PATTERN = re.compile(r"^\s*#\s*\[(.+?)\]\s*$")


def find_agent_md(goal_dir: str) -> Optional[str]:
    """
    向上查找 `.agent/AGENT.md`。
    """
    current = os.path.abspath(goal_dir)
    while True:
        candidate = os.path.join(current, ".agent", "AGENT.md")
        if os.path.exists(candidate):
            return candidate

        parent = os.path.dirname(current)
        if parent == current:
            return None
        current = parent


def load_agent_config(goal_dir: str) -> Dict[str, Any]:
    path = find_agent_md(goal_dir)
    if not path:
        return DEFAULT_AGENT_CONFIG.copy()

    parsed = parse_agent_md(path)
    merged = DEFAULT_AGENT_CONFIG.copy()
    merged.update(parsed.get("all", {}))
    merged.update(parsed.get("decompose", {}))
    if parsed.get("learned_patterns"):
        merged["learned_patterns"] = parsed["learned_patterns"]
    merged["_path"] = path
    return _normalize_agent_config(merged)


def parse_agent_md(path: str) -> Dict[str, Any]:
    sections: Dict[str, Any] = {}
    current_name: Optional[str] = None
    current_lines = []

    with open(path, "r", encoding="utf-8") as f:
        for raw_line in f:
            line = raw_line.rstrip("\n")
            match = SECTION_PATTERN.match(line)
            if match:
                if current_name is not None:
                    sections[current_name] = _parse_section(current_name, current_lines)
                current_name = match.group(1).strip().lower()
                current_lines = []
                continue
            current_lines.append(line)

    if current_name is not None:
        sections[current_name] = _parse_section(current_name, current_lines)

    return sections


def _parse_section(name: str, lines: list[str]) -> Any:
    body = "\n".join(lines).strip()
    if not body:
        return {} if name != "learned_patterns" else ""

    if name == "learned_patterns":
        return body

    data: Dict[str, Any] = {}
    for line in body.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("//"):
            continue
        if ":" not in stripped:
            continue
        key, raw_value = stripped.split(":", 1)
        data[_to_snake_case(key.strip())] = _parse_value(raw_value.strip())
    return data


def _parse_value(raw: str) -> Any:
    if not raw:
        return ""

    lowered = raw.lower()
    if lowered == "true":
        return True
    if lowered == "false":
        return False

    try:
        return int(raw)
    except ValueError:
        pass

    try:
        return float(raw)
    except ValueError:
        pass

    if raw.startswith("{") or raw.startswith("["):
        normalized = raw.replace("reservedOutput", "'reservedOutput'")
        try:
            return ast.literal_eval(normalized)
        except Exception:
            try:
                return ast.literal_eval(_quote_mapping_keys(raw))
            except Exception:
                return raw

    if (raw.startswith('"') and raw.endswith('"')) or (
        raw.startswith("'") and raw.endswith("'")
    ):
        return raw[1:-1]

    return raw


def _quote_mapping_keys(raw: str) -> str:
    return re.sub(r"([{\[,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)", r"\1'\2'\3", raw)


def _normalize_agent_config(config: Dict[str, Any]) -> Dict[str, Any]:
    normalized = dict(config)

    if "context_budget" in normalized and isinstance(normalized["context_budget"], dict):
        budget = dict(normalized["context_budget"])
        if "reservedOutput" in budget and "reserved_output" not in budget:
            budget["reserved_output"] = budget.pop("reservedOutput")
        normalized["context_budget"] = budget

    if "maxoutputlength" in normalized and "max_output_length" not in normalized:
        normalized["max_output_length"] = normalized.pop("maxoutputlength")
    if "contextmaxchars" in normalized and "context_max_chars" not in normalized:
        normalized["context_max_chars"] = normalized.pop("contextmaxchars")

    return normalized


def build_agent_context(config: Dict[str, Any], role: str) -> str:
    """
    只把当前角色需要的 AGENT 约束注入给模型。
    """
    lines = []
    path = config.get("_path")
    if path:
        lines.append(f"AGENT.md: {path}")

    keys_by_role = {
        "planner": ("max_depth", "learned_patterns"),
        "coder": (
            "max_output_length",
            "context_budget",
            "learned_patterns",
        ),
        "observer": ("learned_patterns",),
        "default": ("learned_patterns",),
    }

    for key in keys_by_role.get(role, keys_by_role["default"]):
        value = config.get(key)
        if value in (None, "", {}):
            continue
        lines.append(f"{key}: {value}")

    return "\n".join(lines)


def _to_snake_case(value: str) -> str:
    value = value.replace("-", "_")
    value = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", value)
    return value.strip().lower()
