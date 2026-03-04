"""
权限配置加载与权限校验
"""

import os
import json
from typing import Dict, Any, Optional
from pathlib import Path

# 默认权限配置
DEFAULT_PERMISSIONS = {
    "read": [],  # 默认允许读当前目录和父目录
    "write": ["./"],  # 默认只能写当前目录
    "bash": {"network": True, "delete": True},
    "max_depth": 4,
    "max_output_length": 102400,
    "context_budget": {"total": 200000, "reservedOutput": 4000},
}


def load_permissions(goal_dir: str) -> Dict[str, Any]:
    """
    加载节点的 permissions.json
    不存在时使用默认值
    """
    permissions_path = os.path.join(goal_dir, "permissions.json")

    if os.path.exists(permissions_path):
        with open(permissions_path, "r", encoding="utf-8") as f:
            node_permissions = json.load(f)

        # 合并默认权限
        merged = DEFAULT_PERMISSIONS.copy()
        merged.update(node_permissions)
        return merged
    else:
        # 检查父目录是否有权限配置，继承权限
        parent_dir = os.path.dirname(goal_dir)
        # 防止无限递归：检查是否到达根目录
        if parent_dir and parent_dir != goal_dir and os.path.exists(parent_dir):
            # 检查父目录是否有 permissions.json
            parent_perm_path = os.path.join(parent_dir, "permissions.json")
            if os.path.exists(parent_perm_path):
                parent_permissions = load_permissions(parent_dir)
                # 子节点权限不能超过父节点
                return inherit_permissions(parent_permissions, DEFAULT_PERMISSIONS)

        return DEFAULT_PERMISSIONS.copy()


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

    # 读取权限：子节点只能缩小，不能扩大
    if "read" in child:
        parent_read = set(parent.get("read", []))
        child_read = set(child.get("read", []))
        result["read"] = (
            list(parent_read & child_read) if parent_read else list(child_read)
        )

    # 写入权限：子节点只能缩小，不能扩大
    if "write" in child:
        parent_write = set(parent.get("write", []))
        child_write = set(child.get("write", []))
        result["write"] = (
            list(parent_write & child_write) if parent_write else list(child_write)
        )

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
    path_abs = os.path.abspath(path)
    node_dir_abs = os.path.abspath(node_dir)

    if permission_type == "read":
        allowed = permissions.get("read", [])
        if not allowed:
            # 默认允许读当前目录和.agent目录
            work_dir = os.path.dirname(node_dir_abs)
            agent_dir = os.path.join(work_dir, ".agent")
            return path_abs.startswith(node_dir_abs) or path_abs.startswith(agent_dir)

        for allow in allowed:
            allow_abs = os.path.abspath(os.path.join(node_dir_abs, allow))
            if (
                path_abs.startswith(allow_abs.rstrip("/") + "/")
                or path_abs == allow_abs
            ):
                return True
        return False

    elif permission_type == "write":
        allowed = permissions.get("write", [])
        if not allowed:
            return path_abs.startswith(node_dir_abs)

        for allow in allowed:
            allow_abs = os.path.abspath(os.path.join(node_dir_abs, allow))
            if (
                path_abs.startswith(allow_abs.rstrip("/") + "/")
                or path_abs == allow_abs
            ):
                return True
        return False

    elif permission_type == "bash":
        bash_perms = permissions.get("bash", {})
        return bash_perms.get("network", True) or bash_perms.get("delete", True)

    return False


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
