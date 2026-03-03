#!/usr/bin/env python3
"""
api_server.py — Survey Agent Python Web API Server

运行: python api_server.py  (port 8001)

依赖:
    pip install fastapi uvicorn requests pydantic

API 端点:
    GET  /api/topics                  - 获取所有知识板块
    GET  /api/topics/:id/papers       - 获取指定板块的论文列表
    GET  /api/papers/:arxiv_id        - 获取单篇论文详情
    GET  /api/run/status              - 获取当前运行状态
    POST /api/run/trigger             - 手动触发一次完整流水线
    GET  /api/run/stream               - SSE 实时推送 Agent 进度事件
    POST /api/papers/:arxiv_id/feedback - 保存用户对论文的评分/标注
    PUT  /api/config/topics           - 修改用户兴趣配置
    GET  /api/trends                  - 获取趋势数据
    GET  /api/config                  - 获取配置（脱敏）
"""

import asyncio
import json
import os
import subprocess
import sys
import threading
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import uvicorn

# 基础路径配置
BASE_DIR = Path(__file__).parent.absolute()
KB_DIR = BASE_DIR / "knowledge_base"
DATA_DIR = BASE_DIR / "data"
CONFIG_FILE = BASE_DIR / "config" / "user_config.json"

# 创建必要目录
DATA_DIR.mkdir(parents=True, exist_ok=True)
(KB_DIR / "pdfs").mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Survey Agent Python API", version="1.0.0")

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 全局运行状态
run_state: Dict[str, Any] = {
    "status": "idle",  # idle | running | completed | failed
    "run_id": None,
    "stage": None,
    "progress": {"current": 0, "total": 0},
    "summary": {},
    "started_at": None,
    "finished_at": None,
    "message": "",
}

# SSE 客户端连接池
sse_clients: List[asyncio.Queue] = []
main_loop: Optional[asyncio.AbstractEventLoop] = None


class RunTriggerRequest(BaseModel):
    """前端触发运行时可选的过滤参数"""

    start_date: Optional[str] = None  # YYYYMMDD
    end_date: Optional[str] = None  # YYYYMMDD
    max_results: Optional[int] = None
    research_query: Optional[str] = None


def broadcast(event: str, data: Dict[str, Any]):
    """从后台线程向所有 SSE 客户端广播事件（线程安全）"""
    if not sse_clients:
        return

    msg = f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

    def _put(q):
        try:
            if main_loop and main_loop.is_running():
                asyncio.run_coroutine_threadsafe(q.put(msg), main_loop)
        except Exception:
            pass

    for q in sse_clients:
        try:
            _put(q)
        except Exception:
            pass


def load_config() -> Dict[str, Any]:
    """加载用户配置"""
    if not CONFIG_FILE.exists():
        return {
            "topics": [],
            "global_settings": {
                "fetch_max_papers": 5,
                "screening_threshold": 7.0,
                "schedule_utc_hour": 8,
                "debug": False,
                "llm": {
                    "baseUrl": "http://35.220.164.252:3888/v1",
                    "model": "MiniMax-M2.5",
                    "apiKey": "",
                },
                "sdk_url": "http://127.0.0.1:3890",
            },
        }

    with open(CONFIG_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_config(config: Dict[str, Any]):
    """保存用户配置"""
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)


def run_pipeline_thread(
    run_id: str, config: Dict[str, Any], options: Optional[Dict[str, Any]] = None
):
    """
    后台线程：执行完整 Agent 流水线。

    通过调用 meta-agent-core SDK，让 Agent 根据 .agent/AGENT.md + skills
    自动推理并执行 Survey Workflow（Fetcher → Screener → Analyst）。
    """
    import requests as req

    SDK_URL = config["global_settings"]["sdk_url"]
    DEBUG_MODE = config["global_settings"].get("debug", False)
    today = datetime.now().strftime("%Y-%m-%d")

    # 本次运行的可选过滤参数
    options = options or {}

    def debug_broadcast(event: str, data: Dict[str, Any]):
        """仅在debug模式下发送调试事件"""
        if DEBUG_MODE:
            broadcast(f"debug_{event}", data)

    try:
        run_state["status"] = "running"
        broadcast(
            "pipeline_start",
            {"run_id": run_id, "date": today, "debug_mode": DEBUG_MODE},
        )

        # 构造调用参数
        # 1. 高层 goal：让 Agent 根据 AGENT.md 自己推理 workflow
        goal = (
            f"执行一次完整的 Survey Workflow。根据 config/user_config.json 中的 topics 配置，"
            f"从 arXiv 抓取最新论文，筛选高潜力论文并生成总结，写入知识库。"
        )

        # 如果有过滤参数，加入 goal
        if options.get("start_date"):
            goal += f" 抓取时间范围：{options['start_date']} 至 {options.get('end_date', '最新')}"
        if options.get("max_results"):
            goal += f" 最多抓取 {options['max_results']} 篇论文"
        if options.get("research_query"):
            goal += f" 搜索关键词：{options['research_query']}"

        # 2. 构造 collectConfig.sources
        sources = [
            # AGENT.md - 核心 workflow 定义
            {"type": "file", "query": ".agent/AGENT.md"},
            # Skills 文档
            {"type": "skills", "query": "arxiv_api"},
            {"type": "skills", "query": "screening"},
            {"type": "skills", "query": "writing"},
            {"type": "skills", "query": "pdf_extract"},
            # 模板
            {"type": "file", "query": "templates/paper_summary.md"},
            # 用户配置
            {"type": "file", "query": "config/user_config.json"},
        ]

        # 动态添加 knowledge_base 中各 topic 的 meta.json
        for kb_path in KB_DIR.glob("*/meta.json"):
            topic_name = kb_path.parent.name
            sources.append(
                {"type": "file", "query": f"knowledge_base/{topic_name}/meta.json"}
            )

        # 广播开始
        broadcast(
            "agent_start",
            {"run_id": run_id, "goal": goal[:200], "sources_count": len(sources)},
        )

        # 调用 SDK 执行 Agent
        debug_broadcast(
            "sdk_call", {"goal": goal, "sources": [s.get("query", "") for s in sources]}
        )

        try:
            r = req.post(
                f"{SDK_URL}/run",
                json={
                    "goal": goal,
                    "workDir": str(BASE_DIR),
                    "collectConfig": {
                        "sources": sources,
                        "maxTokens": 8000,
                    },
                    "llm": config["global_settings"]["llm"],
                    "thresholds": {
                        "maxIterations": 100,
                        "maxNoProgress": 10,
                    },
                    "debug": DEBUG_MODE,
                },
                timeout=1800,  # 30 分钟超时
            )
            result = r.json()
            debug_broadcast(
                "sdk_result",
                {
                    "status": result.get("status"),
                    "has_error": bool(result.get("error")),
                },
            )
        except Exception as e:
            result = {"status": "error", "reason": str(e)}
            debug_broadcast("sdk_error", {"error": str(e)})

        # 处理结果
        if result.get("status") in ("completed", "escalated", "budget_exceeded"):
            run_state["status"] = "completed"
            run_state["summary"]["agent_status"] = result.get("status")

            broadcast(
                "pipeline_done",
                {
                    "run_id": run_id,
                    "status": "completed",
                    "agent_result": result.get("result", {}),
                },
            )
        else:
            run_state["status"] = "failed"
            run_state["message"] = result.get("reason", "Agent execution failed")

            broadcast(
                "pipeline_done",
                {
                    "run_id": run_id,
                    "status": "failed",
                    "error": result.get("reason"),
                },
            )

        # 写入运行日志
        log_entry = {
            "run_id": run_id,
            "date": today,
            "status": run_state["status"],
            "agent_status": result.get("status"),
            "started_at": run_state["started_at"],
            "finished_at": datetime.now().isoformat(),
            "options": options,
        }
        log_file = DATA_DIR / "run_log.jsonl"
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(log_entry, ensure_ascii=False) + "\n")

        run_state["status"] = "idle"

    except Exception as e:
        run_state["status"] = "failed"
        run_state["message"] = str(e)
        broadcast(
            "pipeline_done", {"run_id": run_id, "status": "failed", "error": str(e)}
        )
        print(f"Pipeline error: {e}", file=sys.stderr)


# ==================== API 路由 ====================


@app.on_event("startup")
async def startup():
    global main_loop
    main_loop = asyncio.get_event_loop()

    # 初始化空数据文件
    for f in ["feedback.json", "blacklist.json"]:
        fpath = DATA_DIR / f
        if not fpath.exists():
            fpath.write_text("{}")


@app.get("/api/topics")
async def get_topics():
    """获取所有知识板块"""
    topics = []
    for meta_path in sorted(KB_DIR.glob("*/meta.json")):
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            topic_id = meta_path.parent.name
            paper_count = len(list(meta_path.parent.glob("paper_*.md")))

            topics.append(
                {
                    "id": topic_id,
                    "name": meta.get("name", topic_id),
                    "description": meta.get("description", ""),
                    "keywords": meta.get("keywords", []),
                    "paper_count": paper_count,
                    "updated_at": meta.get("updated_at", ""),
                    "arxiv_categories": meta.get("arxiv_categories", []),
                }
            )
        except Exception as e:
            print(f"Error reading {meta_path}: {e}", file=sys.stderr)

    return topics


@app.get("/api/topics/{topic_id}/papers")
async def get_papers(topic_id: str, page: int = 1, limit: int = 20):
    """获取指定板块的论文列表"""
    topic_dir = KB_DIR / topic_id
    if not topic_dir.exists():
        raise HTTPException(status_code=404, detail="Topic not found")

    papers = []
    for p in sorted(topic_dir.glob("paper_*.md"), reverse=True):
        try:
            content = p.read_text(encoding="utf-8")
            # 简单解析 front-matter (title 在第一行)
            lines = content.split("\n")
            title = lines[0].replace("# ", "").strip() if lines else p.stem

            # 提取 arxiv_id
            arxiv_id = p.stem.replace("paper_", "")

            papers.append(
                {
                    "arxiv_id": arxiv_id,
                    "title": title,
                    "preview": content[:300],
                    "filename": p.name,
                }
            )
        except Exception as e:
            print(f"Error reading {p}: {e}", file=sys.stderr)

    total = len(papers)
    start = (page - 1) * limit
    end = start + limit

    return {
        "papers": papers[start:end],
        "total": total,
        "page": page,
        "total_pages": (total + limit - 1) // limit,
    }


@app.get("/api/papers/{arxiv_id}")
async def get_paper(arxiv_id: str):
    """获取单篇论文详情"""
    # 搜索论文
    for paper_file in KB_DIR.glob("*/paper_*.md"):
        if arxiv_id in paper_file.stem:
            content = paper_file.read_text(encoding="utf-8")
            topic = paper_file.parent.name

            return {
                "arxiv_id": arxiv_id,
                "content": content,
                "topic": topic,
                "html_content": content,
            }

    raise HTTPException(status_code=404, detail="Paper not found")


@app.get("/api/run/status")
async def run_status():
    """获取当前运行状态"""
    return run_state


@app.post("/api/run/trigger")
async def trigger_run(body: Optional[RunTriggerRequest] = None):
    """手动触发一次完整流水线，可附带过滤参数"""
    if run_state["status"] == "running":
        raise HTTPException(status_code=409, detail="Pipeline already running")

    config = load_config()
    run_id = f"run_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

    options: Dict[str, Any] = body.dict() if body else {}

    run_state.update(
        {
            "run_id": run_id,
            "started_at": datetime.now().isoformat(),
            "status": "starting",
            "stage": None,
            "summary": {},
            "message": "",
            "options": options,
        }
    )

    thread = threading.Thread(
        target=run_pipeline_thread, args=(run_id, config, options), daemon=True
    )
    thread.start()

    return {"run_id": run_id, "status": "started", "options": options}


@app.get("/api/run/stream")
async def run_stream():
    """SSE 实时推送"""
    q = asyncio.Queue()
    sse_clients.append(q)

    async def gen():
        try:
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=15)
                    yield msg
                except asyncio.TimeoutError:
                    yield f"event: heartbeat\ndata: {json.dumps({'ts': int(datetime.now().timestamp())})}\n\n"
        finally:
            if q in sse_clients:
                sse_clients.remove(q)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/papers/{arxiv_id}/feedback")
async def save_feedback(arxiv_id: str, body: dict):
    """保存用户对论文的评分"""
    fb_path = DATA_DIR / "feedback.json"

    try:
        feedback = (
            json.loads(fb_path.read_text(encoding="utf-8")) if fb_path.exists() else {}
        )
    except:
        feedback = {}

    feedback[arxiv_id] = {**body, "ts": datetime.now().isoformat()}

    fb_path.write_text(json.dumps(feedback, ensure_ascii=False, indent=2))

    # 如果评分 <= 2，加入黑名单
    rating = body.get("rating", 5)
    if rating <= 2:
        bl_path = DATA_DIR / "blacklist.json"
        try:
            blacklist = (
                json.loads(bl_path.read_text(encoding="utf-8"))
                if bl_path.exists()
                else []
            )
        except:
            blacklist = []

        if arxiv_id not in blacklist:
            blacklist.append(arxiv_id)
            bl_path.write_text(json.dumps(blacklist, indent=2))

    return {"ok": True}


@app.get("/api/config")
async def get_config():
    """获取配置（脱敏）"""
    config = load_config()

    # 脱敏
    if "apiKey" in config.get("global_settings", {}).get("llm", {}):
        config["global_settings"]["llm"]["apiKey"] = "***"

    return config


@app.put("/api/config/debug")
async def update_debug_config(body: dict):
    """更新debug配置"""
    config = load_config()
    debug_enabled = body.get("debug", False)

    if "global_settings" not in config:
        config["global_settings"] = {}

    config["global_settings"]["debug"] = debug_enabled
    save_config(config)

    return {"ok": True, "debug": debug_enabled}


@app.put("/api/config/topics")
async def update_topics(body: dict):
    """更新主题配置"""
    config = load_config()
    config["topics"] = body.get("topics", [])
    save_config(config)
    return {"ok": True, "effective_at": "next_run"}


@app.get("/api/trends")
async def get_trends(days: int = 90):
    """获取趋势数据"""
    trends = {"daily_counts": {}, "topic_monthly": {}, "rising_keywords": []}

    # 读取历史运行日志
    log_file = DATA_DIR / "run_log.jsonl"
    if log_file.exists():
        with open(log_file, "r", encoding="utf-8") as f:
            for line in f:
                try:
                    entry = json.loads(line)
                    date = entry.get("date", "")
                    summary = entry.get("summary", {})

                    if date:
                        trends["daily_counts"][date] = summary.get("fetched", 0)
                except:
                    pass

    # 读取各板块的论文统计
    for topic_dir in KB_DIR.iterdir():
        if topic_dir.is_dir() and (topic_dir / "meta.json").exists():
            meta = json.loads((topic_dir / "meta.json").read_text(encoding="utf-8"))
            topic_id = topic_dir.name
            trends["topic_monthly"][topic_id] = {
                "name": meta.get("name", topic_id),
                "paper_count": meta.get("paper_count", 0),
            }

    return trends


@app.get("/api/run/history")
async def get_history(limit: int = 10):
    """获取历史运行记录"""
    log_file = DATA_DIR / "run_log.jsonl"
    history = []

    if log_file.exists():
        with open(log_file, "r", encoding="utf-8") as f:
            lines = f.readlines()
            for line in reversed(lines[-limit:]):
                try:
                    history.append(json.loads(line))
                except:
                    pass

    return history


@app.get("/api/health")
async def health_check():
    """健康检查"""
    config = load_config()
    sdk_url = config.get("global_settings", {}).get("sdk_url", "http://127.0.0.1:3890")

    import requests

    try:
        r = requests.get(f"{sdk_url}/health", timeout=5)
        sdk_status = "healthy" if r.status_code == 200 else "unhealthy"
    except:
        sdk_status = "unavailable"

    return {
        "status": "ok",
        "timestamp": datetime.now().isoformat(),
        "sdk_status": sdk_status,
    }


if __name__ == "__main__":
    print(f"Survey Agent Python API Server starting at http://0.0.0.0:8001")
    print(f"Base directory: {BASE_DIR}")
    print(f"Knowledge base: {KB_DIR}")
    print(f"Data directory: {DATA_DIR}")

    uvicorn.run(app, host="0.0.0.0", port=8001, log_level="info")
