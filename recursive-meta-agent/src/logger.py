"""
全局日志记录器
负责写 memory.jsonl
"""

import os
import json
from datetime import datetime
from typing import Dict, Any, Optional


class Logger:
    """
    全局日志记录器
    所有写入追加，不清空
    """

    _instance = None

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self, work_dir: str = None):
        if hasattr(self, "_initialized") and self._initialized:
            return

        self._initialized = True
        self.work_dir = work_dir
        self.agent_dir = None

        if work_dir:
            self.agent_dir = os.path.join(work_dir, ".agent")
            os.makedirs(self.agent_dir, exist_ok=True)

    def set_work_dir(self, work_dir: str):
        """设置工作目录"""
        self.work_dir = work_dir
        self.agent_dir = os.path.join(work_dir, ".agent")
        os.makedirs(self.agent_dir, exist_ok=True)

    def _get_timestamp(self) -> str:
        """获取时间戳"""
        return datetime.now().isoformat()

    def _get_memory_path(self) -> str:
        """获取 memory.jsonl 路径"""
        if not self.agent_dir:
            raise ValueError("work_dir not set")
        return os.path.join(self.agent_dir, "memory.jsonl")

    def log_memory(
        self,
        session_id: str,
        task_type: str,
        goal_summary: str,
        solution_pattern: str,
        reliability: float,
        depth_used: int,
        avg_retries: float,
    ) -> None:
        """
        追加写 .agent/memory.jsonl
        """
        record = {
            "ts": self._get_timestamp(),
            "session_id": session_id,
            "task_type": task_type,
            "goal_summary": goal_summary,
            "solution_pattern": solution_pattern,
            "reliability": reliability,
            "depth_used": depth_used,
            "avg_retries": avg_retries,
        }

        memory_path = self._get_memory_path()
        with open(memory_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

    def get_recent_memory(self, limit: int = 5) -> list:
        """
        获取最近的记忆
        """
        memory_path = self._get_memory_path()

        if not os.path.exists(memory_path):
            return []

        with open(memory_path, "r", encoding="utf-8") as f:
            lines = f.readlines()

        # 返回最近 N 条
        recent = lines[-limit:] if len(lines) > limit else lines

        memories = []
        for line in recent:
            try:
                memories.append(json.loads(line.strip()))
            except json.JSONDecodeError:
                continue

        return memories


# 全局单例
_global_logger: Optional[Logger] = None


def get_logger(work_dir: str = None) -> Logger:
    """获取全局 logger 实例"""
    global _global_logger

    if _global_logger is None:
        _global_logger = Logger(work_dir)
    elif work_dir:
        _global_logger.set_work_dir(work_dir)

    return _global_logger


def reset_logger():
    """重置 logger（用于测试）"""
    global _global_logger
    _global_logger = None
