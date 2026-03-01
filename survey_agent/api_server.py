#!/usr/bin/env python3
"""
api_server.py — Survey Agent Web API Server

运行: python api_server.py  (port 8000)

依赖:
    pip install fastapi uvicorn python-frontmatter markdown requests schedule feedparser

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
import sys
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

# 基础路径配置
BASE_DIR = Path(__file__).parent.absolute()
KB_DIR = BASE_DIR / "knowledge_base"
DATA_DIR = BASE_DIR / "data"
CONFIG_FILE = BASE_DIR / "config" / "user_config.json"

# 创建必要目录
DATA_DIR.mkdir(parents=True, exist_ok=True)
(KB_DIR / "pdfs").mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Survey Agent API", version="1.0.0")

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


def broadcast(event: str, data: Dict[str, Any]):
    """从后台线程向所有 SSE 客户端广播事件（线程安全）"""
    if not sse_clients:
        return

    msg = f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

    def _put(q):
        try:
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
                "fetch_max_papers": 100,
                "screening_threshold": 7.0,
                "schedule_utc_hour": 8,
                "llm": {
                    "baseUrl": "http://35.220.164.252:3888/v1",
                    "model": "MiniMax-M2.5",
                    "apiKey": "",
                },
                "sdk_url": "http://127.0.0.1:3889",
            },
        }

    with open(CONFIG_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_config(config: Dict[str, Any]):
    """保存用户配置"""
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)


def run_pipeline_thread(run_id: str, config: Dict[str, Any]):
    """后台线程：执行完整 Agent 流水线，通过 broadcast 推送进度"""
    import requests as req

    SDK_URL = config["global_settings"]["sdk_url"]
    today = datetime.now().strftime("%Y-%m-%d")

    def sdk_run(goal: str, sources: List[Dict], msg: str = "") -> Dict:
        """调用 SDK /run 接口"""
        broadcast(
            "agent_progress",
            {"stage": run_state["stage"], "message": msg or goal[:100]},
        )

        try:
            r = req.post(
                f"{SDK_URL}/run",
                json={
                    "goal": goal,
                    "workDir": str(BASE_DIR),
                    "collectConfig": {"sources": sources, "maxTokens": 6000},
                    "llm": config["global_settings"]["llm"],
                    "thresholds": {"maxIterations": 30, "maxNoProgress": 3},
                },
                timeout=300,
            )
            return r.json()
        except Exception as e:
            return {"status": "error", "reason": str(e)}

    try:
        run_state["status"] = "running"
        broadcast("pipeline_start", {"run_id": run_id, "date": today})

        # === Step 1: Fetcher ===
        run_state["stage"] = "fetcher"
        broadcast(
            "stage_start", {"stage": "fetcher", "message": "开始从 arXiv 抓取论文..."}
        )

        cats = list({c for t in config["topics"] for c in t["arxiv_categories"]})
        res = sdk_run(
            f"从arXiv获取{today}最新论文，分类:{cats}，最多{config['global_settings']['fetch_max_papers']}篇，"
            f"写入data/raw_papers_{today}.json",
            [
                {"type": "file", "query": "scripts/fetch_arxiv.py"},
                {"type": "file", "query": "config/user_config.json"},
            ],
            "正在调用 arXiv API...",
        )

        if res.get("status") not in ("completed", "escalated"):
            raise RuntimeError(f"Fetcher failed: {res.get('reason', 'Unknown error')}")

        # 读取抓取结果
        raw_file = DATA_DIR / f"raw_papers_{today}.json"
        if raw_file.exists():
            with open(raw_file, "r", encoding="utf-8") as f:
                raw_papers = json.load(f)
                raw_count = len(raw_papers)
        else:
            raw_count = 0

        run_state["summary"]["fetched"] = raw_count
        broadcast("stage_done", {"stage": "fetcher", "result": {"fetched": raw_count}})

        # === Step 2: Screener ===
        run_state["stage"] = "screener"
        broadcast(
            "stage_start",
            {"stage": "screener", "message": f"筛选 {raw_count} 篇论文..."},
        )

        # 读取黑名单
        bl_path = DATA_DIR / "blacklist.json"
        blacklist = json.loads(bl_path.read_text()) if bl_path.exists() else []
        bl_note = (
            f"以下ID已被用户标记不相关，禁止纳入：{blacklist}" if blacklist else ""
        )

        threshold = config["global_settings"]["screening_threshold"]
        res = sdk_run(
            f"筛选data/raw_papers_{today}.json，结合各板块meta.json，评分阈值{threshold}，"
            f"输出data/selected_papers_{today}.json。{bl_note}",
            [
                {"type": "file", "query": f"data/raw_papers_{today}.json"},
                {
                    "type": "bash",
                    "query": "find knowledge_base -name 'meta.json' | xargs cat",
                },
            ],
            "LLM 正在对论文打分...",
        )

        if res.get("status") not in ("completed", "escalated"):
            raise RuntimeError(f"Screener failed: {res.get('reason', 'Unknown error')}")

        # 读取筛选结果
        selected_file = DATA_DIR / f"selected_papers_{today}.json"
        if selected_file.exists():
            with open(selected_file, "r", encoding="utf-8") as f:
                selected = json.load(f)
                selected_count = len(selected)
        else:
            selected_count = 0

        run_state["summary"]["selected"] = selected_count
        broadcast(
            "stage_done", {"stage": "screener", "result": {"selected": selected_count}}
        )

        # === Step 3: Analyst（逐篇）===
        run_state["stage"] = "analyst"
        run_state["progress"] = {"current": 0, "total": selected_count}
        broadcast(
            "stage_start",
            {"stage": "analyst", "message": f"精读 {selected_count} 篇论文..."},
        )

        analyzed = failed = 0

        if selected_count > 0:
            for i, paper in enumerate(selected):
                try:
                    target_topic = paper.get("target_topic", "unknown")
                    res = sdk_run(
                        f"深度分析 {paper['arxiv_id']}（{paper['title']}），"
                        f"下载PDF，生成总结，写入knowledge_base/{target_topic}/paper_{paper['arxiv_id']}.md，"
                        f"更新meta.json",
                        [
                            {"type": "file", "query": "templates/paper_summary.md"},
                            {
                                "type": "file",
                                "query": f"knowledge_base/{target_topic}/meta.json",
                            },
                        ],
                        f"正在分析: {paper['title'][:40]}...",
                    )

                    if res.get("status") == "completed":
                        analyzed += 1
                        broadcast(
                            "paper_analyzed",
                            {
                                "arxiv_id": paper["arxiv_id"],
                                "title": paper["title"],
                                "topic": target_topic,
                                "score": paper.get("relevance_score"),
                                "progress": {"current": i + 1, "total": selected_count},
                            },
                        )
                    else:
                        raise RuntimeError(res.get("reason", "Analysis failed"))

                except Exception as e:
                    failed += 1
                    broadcast(
                        "paper_failed",
                        {"arxiv_id": paper["arxiv_id"], "reason": str(e)},
                    )

                run_state["progress"]["current"] = i + 1

        run_state["status"] = "completed"
        run_state["finished_at"] = datetime.now().isoformat()
        run_state["summary"].update({"analyzed": analyzed, "failed": failed})

        broadcast(
            "pipeline_done",
            {
                "run_id": run_id,
                "status": "completed",
                "summary": run_state["summary"],
                "duration_sec": 0,  # 可添加时间计算
            },
        )

        # 写入运行日志
        log_entry = {
            "run_id": run_id,
            "date": today,
            "status": "completed",
            "summary": run_state["summary"],
            "started_at": run_state["started_at"],
            "finished_at": run_state["finished_at"],
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
                "html_content": content,  # 可以添加 markdown 转换
            }

    raise HTTPException(status_code=404, detail="Paper not found")


@app.get("/api/run/status")
async def run_status():
    """获取当前运行状态"""
    return run_state


@app.post("/api/run/trigger")
async def trigger_run():
    """手动触发一次完整流水线"""
    if run_state["status"] == "running":
        raise HTTPException(status_code=409, detail="Pipeline already running")

    config = load_config()
    run_id = f"run_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

    run_state.update(
        {
            "run_id": run_id,
            "started_at": datetime.now().isoformat(),
            "status": "starting",
            "stage": None,
            "summary": {},
            "message": "",
        }
    )

    thread = threading.Thread(
        target=run_pipeline_thread, args=(run_id, config), daemon=True
    )
    thread.start()

    return {"run_id": run_id, "status": "started"}


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


# 静态文件服务
from fastapi.staticfiles import StaticFiles

# 挂载前端静态文件
frontend_dir = BASE_DIR / "frontend"
if frontend_dir.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn

    print(f"Survey Agent API Server starting at http://0.0.0.0:8000")
    print(f"Base directory: {BASE_DIR}")
    print(f"Knowledge base: {KB_DIR}")
    print(f"Data directory: {DATA_DIR}")

    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
