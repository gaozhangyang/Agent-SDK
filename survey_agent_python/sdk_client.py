"""
SDK Client - Survey Agent Python 的 meta-agent-core SDK 封装

提供 Python 接口调用 meta-agent-core 的服务，支持：
- 单次运行 Agent
- 带回调的流式运行
- Session 恢复
"""

import json
import time
import uuid
from pathlib import Path
from typing import Optional, Dict, Any, List, Callable, Union
from dataclasses import dataclass, field
from enum import Enum


class RunStatus(Enum):
    """运行状态枚举"""

    IDLE = "idle"
    RUNNING = "running"
    COMPLETED = "completed"
    ESCALATED = "escalated"
    BUDGET_EXCEEDED = "budget_exceeded"
    ERROR = "error"


@dataclass
class CollectSource:
    """Collect 协议源配置"""

    type: str  # file, bash, trace_tag, skills
    query: str
    weight: float = 1.0


@dataclass
class CollectConfig:
    """Collect 协议配置"""

    sources: List[Dict[str, Any]]
    filters: Optional[List[str]] = None
    maxTokens: Optional[int] = None


@dataclass
class LLMConfig:
    """LLM 配置"""

    baseUrl: str
    model: str
    apiKey: str


@dataclass
class RunConfig:
    """SDK 运行配置"""

    goal: str
    workDir: str
    collectConfig: Dict[str, Any]
    llm: Dict[str, Any]
    thresholds: Dict[str, Any] = field(
        default_factory=lambda: {"maxIterations": 50, "maxNoProgress": 5}
    )
    debug: bool = False


@dataclass
class RunResult:
    """运行结果"""

    status: str
    state: Optional[Dict[str, Any]] = None
    traceLength: int = 0
    reason: Optional[str] = None
    error: Optional[str] = None


class MetaAgentSDK:
    """
    meta-agent-core SDK 的 Python 客户端封装

    使用示例:
        sdk = MetaAgentSDK("http://127.0.0.1:3890")

        result = sdk.run(
            goal="分析论文 2602.24289",
            workDir="/path/to/project",
            collectConfig={
                "sources": [
                    {"type": "file", "query": "templates/paper_summary.md"}
                ]
            }
        )
    """

    def __init__(
        self,
        base_url: str = "http://127.0.0.1:3890",
        default_llm: Optional[Dict[str, str]] = None,
        default_workdir: Optional[str] = None,
        timeout: int = 600,
    ):
        """
        初始化 SDK 客户端

        Args:
            base_url: meta-agent-core 服务地址
            default_llm: 默认 LLM 配置
            default_workdir: 默认工作目录
            timeout: 请求超时时间（秒）
        """
        self.base_url = base_url.rstrip("/")
        self.default_llm = default_llm or {}
        self.default_workdir = default_workdir
        self.timeout = timeout

    def run(
        self,
        goal: str,
        workDir: Optional[str] = None,
        collectConfig: Optional[Dict[str, Any]] = None,
        llm: Optional[Dict[str, str]] = None,
        thresholds: Optional[Dict[str, int]] = None,
        debug: bool = False,
        callback: Optional[Callable[[str, Dict], None]] = None,
    ) -> RunResult:
        """
        执行 Agent 任务

        Args:
            goal: 任务目标
            workDir: 工作目录
            collectConfig: Collect 配置
            llm: LLM 配置（覆盖默认配置）
            thresholds: 阈值配置
            debug: 是否启用调试模式
            callback: 进度回调函数 (event_type: str, data: Dict)

        Returns:
            RunResult: 运行结果
        """
        import requests

        workDir = workDir or self.default_workdir
        if not workDir:
            raise ValueError("workDir is required")

        llm = llm or self.default_llm
        if not llm:
            raise ValueError("LLM configuration is required")

        collectConfig = collectConfig or {"sources": []}
        thresholds = thresholds or {"maxIterations": 50, "maxNoProgress": 5}

        payload = {
            "goal": goal,
            "workDir": workDir,
            "collectConfig": collectConfig,
            "llm": llm,
            "thresholds": thresholds,
            "debug": debug,
        }

        try:
            response = requests.post(
                f"{self.base_url}/run", json=payload, timeout=self.timeout
            )
            response.raise_for_status()
            result = response.json()

            return RunResult(
                status=result.get("status", "unknown"),
                state=result.get("state"),
                traceLength=result.get("traceLength", 0),
                reason=result.get("reason"),
            )

        except requests.exceptions.Timeout:
            return RunResult(
                status="error", error=f"Request timeout after {self.timeout}s"
            )
        except requests.exceptions.RequestException as e:
            return RunResult(status="error", error=str(e))

    def run_stream(
        self,
        goal: str,
        workDir: Optional[str] = None,
        collectConfig: Optional[Dict[str, Any]] = None,
        llm: Optional[Dict[str, str]] = None,
        thresholds: Optional[Dict[str, int]] = None,
        debug: bool = False,
        on_progress: Optional[Callable[[str, Dict], None]] = None,
    ) -> RunResult:
        """
        流式执行 Agent 任务（带 SSE 进度推送）

        Args:
            goal: 任务目标
            workDir: 工作目录
            collectConfig: Collect 配置
            llm: LLM 配置
            thresholds: 阈值配置
            debug: 是否启用调试模式
            on_progress: 进度回调函数

        Returns:
            RunResult: 运行结果
        """
        import requests

        workDir = workDir or self.default_workdir
        if not workDir:
            raise ValueError("workDir is required")

        llm = llm or self.default_llm
        if not llm:
            raise ValueError("LLM configuration is required")

        collectConfig = collectConfig or {"sources": []}
        thresholds = thresholds or {"maxIterations": 50, "maxNoProgress": 5}

        # 首先启动任务
        payload = {
            "goal": goal,
            "workDir": workDir,
            "collectConfig": collectConfig,
            "llm": llm,
            "thresholds": thresholds,
            "debug": debug,
        }

        try:
            # 启动运行
            run_response = requests.post(
                f"{self.base_url}/run", json=payload, timeout=self.timeout
            )
            run_response.raise_for_status()
            result = run_response.json()

            # 如果有 on_progress 回调且服务器支持 SSE，启动 SSE 监听
            if on_progress and "streamUrl" in result:
                self._listen_stream(result["streamUrl"], on_progress)

            return RunResult(
                status=result.get("status", "unknown"),
                state=result.get("state"),
                traceLength=result.get("traceLength", 0),
                reason=result.get("reason"),
            )

        except requests.exceptions.RequestException as e:
            return RunResult(status="error", error=str(e))

    def _listen_stream(self, stream_url: str, callback: Callable[[str, Dict], None]):
        """监听 SSE 流"""
        import requests

        try:
            response = requests.get(stream_url, stream=True, timeout=120)
            event_type = "message"  # Default event type
            for line in response.iter_lines():
                if line:
                    line = line.decode("utf-8")
                    if line.startswith("event:"):
                        event_type = line[6:].strip()
                    elif line.startswith("data:"):
                        data = json.loads(line[5:].strip())
                        callback(event_type, data)
        except Exception as e:
            callback("error", {"message": str(e)})

    def check_health(self) -> bool:
        """检查 SDK 服务健康状态"""
        import requests

        try:
            response = requests.get(f"{self.base_url}/health", timeout=5)
            return response.status_code == 200
        except:
            return False

    def get_status(self, workDir: Optional[str] = None) -> Dict[str, Any]:
        """获取当前 Agent 状态"""
        import requests

        workDir = workDir or self.default_workdir
        if not workDir:
            raise ValueError("workDir is required")

        try:
            response = requests.get(
                f"{self.base_url}/status", params={"workDir": workDir}, timeout=5
            )
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            return {"status": "error", "message": str(e)}

    def interrupt(self, workDir: Optional[str] = None, message: str = "") -> bool:
        """中断当前运行"""
        import requests

        workDir = workDir or self.default_workdir
        if not workDir:
            raise ValueError("workDir is required")

        try:
            response = requests.post(
                f"{self.base_url}/interrupt",
                json={"workDir": workDir, "message": message},
                timeout=5,
            )
            return response.status_code == 200
        except:
            return False


# 便捷函数
def create_sdk(
    sdk_url: str = "http://127.0.0.1:3890",
    llm_base_url: str = "http://35.220.164.252:3888/v1",
    llm_model: str = "MiniMax-M2.5",
    llm_api_key: str = "",
    workdir: Optional[str] = None,
) -> MetaAgentSDK:
    """创建 SDK 客户端的便捷函数"""
    return MetaAgentSDK(
        base_url=sdk_url,
        default_llm={
            "baseUrl": llm_base_url,
            "model": llm_model,
            "apiKey": llm_api_key,
        },
        default_workdir=workdir,
    )
