#!/usr/bin/env python3
"""
通过 HTTP 调用 agent-runtime-core SDK 服务（Node 封装）。

先启动服务：cd agent-runtime-core && npm run start:server
再运行本脚本：python client_http.py

配置：同目录 agent_chat_config.json 或环境变量
  - base_url, model_name, api_key 用于 LLM
  - server_url 用于 HTTP 服务地址，默认 http://127.0.0.1:3889
"""

import os
import sys
import json
import tempfile
import subprocess
import shutil

try:
    import requests
except ImportError:
    print("请先安装: pip install requests")
    sys.exit(1)


def load_config():
    defaults = {
        "base_url": "http://35.220.164.252:3888/v1/",
        "model_name": "MiniMax-M2.5",
        "api_key": "",
        "server_url": "http://127.0.0.1:3889",
    }
    config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "agent_chat_config.json")
    if os.path.isfile(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                cfg = json.load(f)
            defaults.update({k: v for k, v in cfg.items() if v is not None and v != ""})
        except Exception:
            pass
    return defaults


def setup_workspace(work_dir: str) -> None:
    """准备带 git 和示例文件的工作目录。"""
    os.makedirs(work_dir, exist_ok=True)
    with open(os.path.join(work_dir, "AGENTS.md"), "w", encoding="utf-8") as f:
        f.write("# 项目上下文\n这是一个示例项目。目标：分析代码并输出建议。\n")
    with open(os.path.join(work_dir, "sample.txt"), "w", encoding="utf-8") as f:
        f.write("示例内容，供 Collect 读取。\n")
    subprocess.run(["git", "init"], cwd=work_dir, check=True, capture_output=True)
    subprocess.run(
        ["git", "config", "user.email", "agent@test.com"],
        cwd=work_dir,
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["git", "config", "user.name", "Agent"],
        cwd=work_dir,
        check=True,
        capture_output=True,
    )
    subprocess.run(["git", "add", "-A"], cwd=work_dir, check=True, capture_output=True)
    subprocess.run(
        ["git", "commit", "-m", "initial"],
        cwd=work_dir,
        check=True,
        capture_output=True,
    )


def main():
    cfg = load_config()
    server_url = os.environ.get("AGENT_SERVER_URL") or cfg.get("server_url", "http://127.0.0.1:3889")
    api_key = os.environ.get("AGENT_LLM_API_KEY") or cfg.get("api_key", "")
    if not api_key:
        print("错误: 请设置 api_key（agent_chat_config.json 或 AGENT_LLM_API_KEY）")
        sys.exit(1)

    # 健康检查
    try:
        r = requests.get(f"{server_url.rstrip('/')}/health", timeout=5)
        r.raise_for_status()
    except Exception as e:
        print(f"无法连接服务 {server_url}，请先启动: cd agent-runtime-core && npm run start:server")
        print("错误:", e)
        sys.exit(1)

    work_dir = tempfile.mkdtemp(prefix="agent_http_")
    try:
        setup_workspace(work_dir)
        base_url = (cfg.get("base_url") or "").rstrip("/")
        if not base_url:
            base_url = "http://35.220.164.252:3888/v1"

        body = {
            "goal": "阅读 AGENTS.md 与 sample.txt，用一句话总结项目目标",
            "subgoals": ["读取并理解上下文", "输出一句话总结"],
            "workDir": work_dir,
            "collectConfig": {
                "sources": [
                    {"type": "file", "query": "AGENTS.md"},
                    {"type": "file", "query": "sample.txt"},
                ],
                "maxTokens": 2000,
            },
            "llm": {
                "baseUrl": base_url,
                "model": cfg.get("model_name", "MiniMax-M2.5"),
                "apiKey": api_key,
            },
            "thresholds": {
                "maxIterations": 15,
                "maxNoProgress": 3,
            },
        }

        print("调用 POST /run ...")
        resp = requests.post(
            f"{server_url.rstrip('/')}/run",
            json=body,
            timeout=120,
        )
        resp.raise_for_status()
        data = resp.json()

        print("=" * 60)
        print("  结果（通过 HTTP 调用 agent-runtime-core SDK）")
        print("=" * 60)
        print("status:", data.get("status"))
        if data.get("reason"):
            print("reason:", data["reason"])
        state = data.get("state", {})
        print("mode:", state.get("mode"), "| 迭代:", state.get("iterationCount"), "| version:", state.get("version"))
        print("trace 条数:", data.get("traceLength", 0))
        print("-" * 60)
        if data.get("traceJson"):
            entries = json.loads(data["traceJson"])
            for e in entries[:12]:
                print(f"  [{e.get('kind')}]", e.get("data", {}))
        print("=" * 60)
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
