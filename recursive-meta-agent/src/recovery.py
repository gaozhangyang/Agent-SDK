"""
Recovery 机制
基于文件系统状态恢复执行
"""

import os
import json
import hashlib
from typing import List, Dict, Any, Optional
from pathlib import Path

from logger import get_logger
from deps import topological_sort


MAX_RETRY = int(os.environ.get("MAX_RETRY", "3"))


def recover(goal_dir: str) -> None:
    """
    基于文件系统状态恢复执行
    scan_tree() 扫描所有节点，topological_order() 排序
    """
    from agent import meta_agent
    from executor import parse_results_content

    logger = get_logger()

    # 扫描所有节点
    nodes = scan_tree(goal_dir)

    # 拓扑排序
    sorted_nodes = topological_order(nodes)

    # 对每个节点处理
    for node in sorted_nodes:
        meta = read_meta(node)
        parent_decomp_id = get_parent_decomposition_id(node, goal_dir)

        results_path = os.path.join(node, "results.md")

        # 1. results.md 存在且 decomposition_id 一致 → 跳过
        if os.path.exists(results_path):
            # 检查 status 是否为 escalated
            with open(results_path, "r", encoding="utf-8") as f:
                results_content = f.read()
            results_data = parse_results_content(results_content)
            status = results_data.get("status", "not_started")

            if meta.get("decomposition_id") == parent_decomp_id:
                if status != "escalated":
                    # 结果有效且未escalated，跳过
                    logger.log_trace(
                        kind="recover_skip", node=node, reason="results_valid"
                    )
                    continue
                else:
                    # 已escalated，检查retry_count
                    if meta.get("retry_count", 0) >= MAX_RETRY:
                        logger.log_trace(
                            kind="recover_escalate", node=node, reason="max_retries"
                        )
                        continue  # 已有最终结果，不再重试
                    # 否则删除重新执行
                    os.remove(results_path)
                    logger.log_trace(
                        kind="recover_invalidate", node=node, reason="retry_available"
                    )
            else:
                # decomposition_id 不一致，删除重新执行
                if os.path.exists(results_path):
                    os.remove(results_path)
                logger.log_trace(
                    kind="recover_invalidate", node=node, reason="decomposition_changed"
                )

        # 2. 重新执行
        # 更新重试次数
        meta["retry_count"] = meta.get("retry_count", 0) + 1
        write_meta(node, meta)

        logger.log_trace(kind="recover_retry", node=node, retry=meta["retry_count"])
        meta_agent(node, depth=meta.get("depth", 0))


def scan_tree(goal_dir: str) -> List[str]:
    """
    扫描所有节点目录
    返回节点路径列表
    """
    nodes = []

    # 递归扫描
    def scan_recursive(current_dir: str):
        # 检查是否是节点目录（包含 goal.md）
        goal_path = os.path.join(current_dir, "goal.md")
        if os.path.exists(goal_path) and current_dir != goal_dir:
            nodes.append(current_dir)

        # 继续扫描子目录
        if os.path.isdir(current_dir):
            try:
                for entry in os.listdir(current_dir):
                    entry_path = os.path.join(current_dir, entry)
                    if os.path.isdir(entry_path):
                        scan_recursive(entry_path)
            except PermissionError:
                pass

    scan_recursive(goal_dir)

    # 添加根节点
    nodes.insert(0, goal_dir)

    return nodes


def topological_order(nodes: List[str]) -> List[str]:
    """
    按深度排序节点
    """

    # 按路径深度排序
    def get_depth(path: str) -> int:
        return path.count(os.sep)

    return sorted(nodes, key=get_depth)


def read_meta(node_dir: str) -> Dict[str, Any]:
    """读取节点的 meta.json"""
    meta_path = os.path.join(node_dir, "meta.json")

    if not os.path.exists(meta_path):
        return {
            "goal_id": "",
            "parent_goal_id": None,
            "depth": 0,
            "decomposition_id": "",
            "status": "not_started",
            "retry_count": 0,
            "context_truncated": False,
            "created_at": "",
            "completed_at": None,
        }

    with open(meta_path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_meta(node_dir: str, meta: Dict[str, Any]) -> None:
    """写入节点的 meta.json"""
    meta_path = os.path.join(node_dir, "meta.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)


def get_parent_decomposition_id(node_dir: str, root_dir: str) -> str:
    """获取父节点的 decomposition_id"""
    # 找到父目录
    parent_dir = os.path.dirname(node_dir)

    if parent_dir == root_dir or parent_dir == "":
        return ""

    # 读取父目录的 meta.json
    parent_meta = read_meta(parent_dir)
    return parent_meta.get("decomposition_id", "")


def escalate(node_dir: str, error_content: str) -> None:
    """
    节点向上 Escalate
    写入自己的 results.md 为 escalated
    """
    from executor import write_results_escalated

    write_results_escalated(node_dir, error_content)

    # 更新 meta
    meta = read_meta(node_dir)
    meta["status"] = "failed"
    write_meta(node_dir, meta)


def get_node_status(node_dir: str) -> str:
    """获取节点状态"""
    from executor import parse_results_content

    results_path = os.path.join(node_dir, "results.md")
    meta = read_meta(node_dir)

    if os.path.exists(results_path):
        with open(results_path, "r", encoding="utf-8") as f:
            content = f.read()
        result = parse_results_content(content)
        return result.get("status", "unknown")

    if meta.get("status") == "running":
        return "running"

    return "not_started"


def check_node_completed(node_dir: str) -> bool:
    """检查节点是否完成"""
    status = get_node_status(node_dir)
    return status in ["completed", "failed", "escalated"]


def clean_node(node_dir: str) -> None:
    """清理节点的中间状态"""
    # 删除 results.md 和 context.md、script.py
    results_path = os.path.join(node_dir, "results.md")
    context_path = os.path.join(node_dir, "context.md")
    script_path = os.path.join(node_dir, "script.py")

    for path in [results_path, context_path, script_path]:
        if os.path.exists(path):
            os.remove(path)

    # 更新 meta
    meta = read_meta(node_dir)
    meta["status"] = "not_started"
    write_meta(node_dir, meta)
