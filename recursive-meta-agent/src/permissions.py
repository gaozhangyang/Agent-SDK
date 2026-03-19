"""
权限配置加载
只保留真正生效的字段：max_depth、bash.network、bash.delete、context_budget 等。
script.py 使用标准 Python，不再做 read/write 路径白名单校验。
"""

import os
import json
from typing import Dict, Any, Tuple

DEFAULT_PERMISSIONS: Dict[str, Any] = {
    "max_depth": 4,
    "bash": {"network": False, "delete": False},
    "max_output_length": 102400,
    "context_budget": {"total": 200000, "reservedOutput": 4000},
    "context_max_chars": 800000,
}


def load_permissions(goal_dir: str) -> Tuple[Dict[str, Any], str]:
    """
    向上遍历目录树，找到第一个 permissions.json 即停止。
    不存在时使用默认值。
    返回: (permissions_dict, permissions_dir)
    """
    current = os.path.abspath(goal_dir)
    start = current

    while True:
        perm_path = os.path.join(current, "permissions.json")
        if os.path.exists(perm_path):
            with open(perm_path, "r", encoding="utf-8") as f:
                node_permissions = json.load(f)
            merged = DEFAULT_PERMISSIONS.copy()
            merged.update(node_permissions)
            if "bash" in node_permissions:
                merged["bash"] = {**DEFAULT_PERMISSIONS["bash"], **node_permissions["bash"]}
            return merged, current

        parent = os.path.dirname(current)
        if parent == current:
            return DEFAULT_PERMISSIONS.copy(), start
        current = parent
