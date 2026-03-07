"""
权限配置加载与权限校验
"""

import os
import json
from typing import Dict, Any, Optional
from pathlib import Path

# 默认权限配置
DEFAULT_PERMISSIONS = {
    "bash": {"network": False, "delete": False},
    "max_depth": 4,
    "max_output_length": 102400,
    "context_budget": {"total": 200000, "reservedOutput": 4000},
}


def load_permissions(goal_dir: str) -> Dict[str, Any]:
    """
    加载节点的 permissions.json
    向上遍历目录树，找到第一个存在 permissions.json 的目录即停止，找到根目录为止。
    不存在时使用默认值。
    返回: (permissions_dict, permissions_dir)
    - permissions_dict: 权限配置
    - permissions_dir: permissions.json 所在的目录（用于解析相对路径）
    """
    current = os.path.abspath(goal_dir)

    while True:
        perm_path = os.path.join(current, "permissions.json")
        if os.path.exists(perm_path):
            with open(perm_path, "r", encoding="utf-8") as f:
                node_permissions = json.load(f)

            # 合并默认权限
            merged = DEFAULT_PERMISSIONS.copy()
            merged.update(node_permissions)
            # 返回权限配置以及permissions.json所在的目录
            return merged, current

        # 向上查找父目录
        parent = os.path.dirname(current)
        if parent == current:  # 到达文件系统根
            return DEFAULT_PERMISSIONS.copy(), current
        current = parent


def inherit_permissions(
    parent: Dict[str, Any], child: Dict[str, Any]
) -> Dict[str, Any]:
    """
    子节点权限不能超过父节点权限
    """
    result = parent.copy()

    # max_depth 不能超过父节点
    if "max_depth" in child:
        result["max_depth"] = min(child["max_depth"], parent.get("max_depth", 4))

    # bash 权限
    if "bash" in child:
        result["bash"] = {
            "network": child["bash"].get("network", True)
            and parent.get("bash", {}).get("network", True),
            "delete": child["bash"].get("delete", True)
            and parent.get("bash", {}).get("delete", True),
        }

    # 其他配置
    if "max_output_length" in child:
        result["max_output_length"] = min(
            child["max_output_length"], parent.get("max_output_length", 102400)
        )

    if "context_budget" in child:
        result["context_budget"] = {
            "total": min(
                child["context_budget"].get("total", 200000),
                parent.get("context_budget", {}).get("total", 200000),
            ),
            "reservedOutput": min(
                child["context_budget"].get("reservedOutput", 4000),
                parent.get("context_budget", {}).get("reservedOutput", 4000),
            ),
        }

    return result


def validate_permission(
    permission_type: str, path: str, permissions: Dict[str, Any], node_dir: str
) -> bool:
    """
    校验权限
    """
    if permission_type == "bash":
        bash_perms = permissions.get("bash", {})
        return bash_perms.get("network", True) or bash_perms.get("delete", True)

    return True  # 默认允许 read/write


def check_read_permission(
    path: str, permissions: Dict[str, Any], node_dir: str
) -> bool:
    """检查读权限"""
    return validate_permission("read", path, permissions, node_dir)


def check_write_permission(
    path: str, permissions: Dict[str, Any], node_dir: str
) -> bool:
    """检查写权限"""
    return validate_permission("write", path, permissions, node_dir)


def save_permissions(goal_dir: str, permissions: Dict[str, Any]) -> None:
    """
    保存权限配置到 permissions.json
    """
    permissions_path = os.path.join(goal_dir, "permissions.json")
    with open(permissions_path, "w", encoding="utf-8") as f:
        json.dump(permissions, f, indent=2, ensure_ascii=False)
