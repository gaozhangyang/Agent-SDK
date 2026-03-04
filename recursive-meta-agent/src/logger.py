"""
全局日志记录器
负责写三个全局文件：trace.jsonl / terminal.md / state.jsonl
"""

import os
import json
import uuid
from datetime import datetime
from pathlib import Path
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
        self._seq = 0

        if work_dir:
            self.agent_dir = os.path.join(work_dir, ".agent")
            os.makedirs(self.agent_dir, exist_ok=True)

    def set_work_dir(self, work_dir: str):
        """设置工作目录"""
        self.work_dir = work_dir
        self.agent_dir = os.path.join(work_dir, ".agent")
        os.makedirs(self.agent_dir, exist_ok=True)

    def _get_seq(self) -> int:
        """获取全局递增序列号"""
        self._seq += 1
        return self._seq

    def _get_timestamp(self) -> str:
        """获取时间戳"""
        return datetime.now().isoformat()

    def _get_trace_path(self) -> str:
        """获取 trace.jsonl 路径"""
        if not self.agent_dir:
            raise ValueError("work_dir not set")
        return os.path.join(self.agent_dir, "trace.jsonl")

    def _get_terminal_path(self) -> str:
        """获取 terminal.md 路径"""
        if not self.agent_dir:
            raise ValueError("work_dir not set")
        return os.path.join(self.agent_dir, "terminal.md")

    def _get_state_path(self) -> str:
        """获取 state.jsonl 路径"""
        if not self.agent_dir:
            raise ValueError("work_dir not set")
        return os.path.join(self.agent_dir, "state.jsonl")

    def _get_memory_path(self) -> str:
        """获取 memory.jsonl 路径"""
        if not self.agent_dir:
            raise ValueError("work_dir not set")
        return os.path.join(self.agent_dir, "memory.jsonl")

    def log_trace(self, kind: str, node: str, **kwargs) -> int:
        """
        追加写 .agent/trace.jsonl
        返回全局递增 seq
        """
        seq = self._get_seq()

        record = {
            "ts": self._get_timestamp(),
            "seq": seq,
            "kind": kind,
            "node": node,
            **kwargs,
        }

        trace_path = self._get_trace_path()
        with open(trace_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

        return seq

    def log_terminal(self, seq: int, node: str, symbol: str, message: str) -> None:
        """
        追加写 .agent/terminal.md
        symbol: 📍 正常，⚠️ 失败
        """
        line = f"{symbol} [seq={seq}] {node} {message}\n"

        terminal_path = self._get_terminal_path()
        with open(terminal_path, "a", encoding="utf-8") as f:
            f.write(line)

    def log_state(self, event: str, **kwargs) -> None:
        """
        追加写 .agent/state.jsonl
        """
        seq = self._get_seq()

        record = {"ts": self._get_timestamp(), "seq": seq, "event": event, **kwargs}

        state_path = self._get_state_path()
        with open(state_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

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

    def get_last_state(self) -> Optional[Dict[str, Any]]:
        """
        获取最后一条状态记录
        """
        state_path = self._get_state_path()

        if not os.path.exists(state_path):
            return None

        with open(state_path, "r", encoding="utf-8") as f:
            lines = f.readlines()

        if not lines:
            return None

        try:
            return json.loads(lines[-1].strip())
        except json.JSONDecodeError:
            return None


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
