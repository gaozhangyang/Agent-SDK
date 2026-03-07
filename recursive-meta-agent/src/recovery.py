"""
Recovery 机制
基于文件系统状态恢复执行，不需要额外的状态管理。

decomposition_id 校验（变更5）：
  每个子节点的 decomposition_id 是其自身 goal.md 内容的 md5 hash。
  Recovery 时只比较该节点自己的 hash，兄弟节点互不影响。
"""

import os
import json
import hashlib
from typing import List, Dict, Any

from logger import get_logger
from deps import topological_sort

MAX_RETRY = int(os.environ.get("MAX_RETRY", "3"))


def recover(goal_dir: str) -> None:
    """
    扫描所有节点，按深度从浅到深逐一检查并补跑失败节点。
    """
    from agent import meta_agent
    from executor import parse_results_content

    logger = get_logger()
    nodes = scan_tree(goal_dir)

    for node in topological_order(nodes):
        meta = read_meta(node)
        results_path = os.path.join(node, "results.md")
        goal_path = os.path.join(node, "goal.md")

        # 没有 goal.md，无法执行，跳过
        if not os.path.exists(goal_path):
            continue

        with open(goal_path, "r", encoding="utf-8") as f:
            current_goal = f.read()
        expected_hash = hashlib.md5(current_goal.encode()).hexdigest()

        if os.path.exists(results_path):
            with open(results_path, "r", encoding="utf-8") as f:
                data = parse_results_content(f.read())
            status = data.get("status", "not_started")

            # decomposition_id 一致且未 escalated → 结果有效，跳过
            if meta.get("decomposition_id") == expected_hash and status != "escalated":
                logger.log_trace(kind="recover_skip", node=node, reason="results_valid")
                continue

            # escalated 且已达重试上限 → 不再重试
            if status == "escalated" and meta.get("retry_count", 0) >= MAX_RETRY:
                logger.log_trace(kind="recover_escalate", node=node, reason="max_retries")
                continue

            # 其他情况（hash 变了、escalated 但可重试）→ 删除结果重新执行
            os.remove(results_path)
            logger.log_trace(kind="recover_invalidate", node=node)

        # 更新重试次数并重新执行
        meta["retry_count"] = meta.get("retry_count", 0) + 1
        write_meta(node, meta)
        logger.log_trace(kind="recover_retry", node=node, retry=meta["retry_count"])
        meta_agent(node, depth=meta.get("depth", 0))


def scan_tree(goal_dir: str) -> List[str]:
    """扫描所有包含 goal.md 的节点目录"""
    nodes = [goal_dir]

    def _scan(current_dir: str):
        if not os.path.isdir(current_dir):
            return
        try:
            for entry in sorted(os.listdir(current_dir)):
                entry_path = os.path.join(current_dir, entry)
                if os.path.isdir(entry_path) and not entry.startswith("."):
                    if os.path.exists(os.path.join(entry_path, "goal.md")):
                        nodes.append(entry_path)
                    _scan(entry_path)
        except PermissionError:
            pass

    _scan(goal_dir)
    return nodes


def topological_order(nodes: List[str]) -> List[str]:
    """按路径深度从浅到深排序"""
    return sorted(nodes, key=lambda p: p.count(os.sep))


def read_meta(node_dir: str) -> Dict[str, Any]:
    """读取节点的 meta.json，不存在时返回默认值"""
    meta_path = os.path.join(node_dir, "meta.json")
    if not os.path.exists(meta_path):
        return {
            "goal_id": "", "parent_goal_id": None, "depth": 0,
            "decomposition_id": "", "status": "not_started",
            "retry_count": 0, "context_truncated": False,
            "created_at": "", "completed_at": None,
        }
    with open(meta_path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_meta(node_dir: str, meta: Dict[str, Any]) -> None:
    """写入节点的 meta.json"""
    meta_path = os.path.join(node_dir, "meta.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)