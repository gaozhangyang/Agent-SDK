#!/usr/bin/env python3
"""
Survey Agent - 文献综述 Agent 应用

基于 agent-runtime-core SDK 的更复杂应用示例：文献综述

功能：
1. 自动准备包含文献摘要的工作目录
2. 调用 SDK 执行多阶段文献综述任务
3. 输出完整的综述报告

使用：
1. 启动服务: cd agent-runtime-core && npm run start:server
2. 运行本脚本: python survey_agent_client.py
"""

import os
import sys
import json
import shutil
import tempfile
import subprocess
from pathlib import Path

try:
    import requests
except ImportError:
    print("请先安装: pip install requests")
    sys.exit(1)


def load_config():
    """加载配置文件"""
    defaults = {
        "base_url": "http://35.220.164.252:3888/v1/",
        "model_name": "MiniMax-M2.5",
        "api_key": "",
        "server_url": "http://127.0.0.1:3889",
    }
    config_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "agent_chat_config.json"
    )
    if os.path.isfile(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                cfg = json.load(f)
            defaults.update({k: v for k, v in cfg.items() if v is not None and v != ""})
        except Exception:
            pass
    return defaults


def get_sample_refs_dir():
    """获取示例参考文献目录"""
    # 相对于本脚本的路径
    script_dir = os.path.dirname(os.path.abspath(__file__))
    refs_dir = os.path.join(script_dir, "survey_agent", "refs")
    if not os.path.isdir(refs_dir):
        raise FileNotFoundError(f"参考文献目录不存在: {refs_dir}")
    return refs_dir


def setup_workspace(work_dir: str, refs_dir: str) -> None:
    """
    准备带文献综述材料的工作目录

    结构：
    work_dir/
    ├── AGENTS.md          # 任务定义
    ├── survey_output.md   # 综述输出文件
    └── refs/              # 文献摘要目录
        ├── sample_ref_1.md
        ├── sample_ref_2.md
        └── sample_ref_3.md
    """
    os.makedirs(work_dir, exist_ok=True)

    # 复制 AGENTS.md（如果存在）
    agents_md_src = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "survey_agent", "AGENTS.md"
    )
    if os.path.isfile(agents_md_src):
        shutil.copy(agents_md_src, os.path.join(work_dir, "AGENTS.md"))
    else:
        # 创建默认 AGENTS.md
        with open(os.path.join(work_dir, "AGENTS.md"), "w", encoding="utf-8") as f:
            f.write("""# 文献综述 Agent 项目上下文

## 角色
你是一个文献综述助手。根据给定的主题与已有文献材料，完成：
- 定义综述范围
- 归纳分类
- 撰写综述正文

## 输入
- 本文件（AGENTS.md）：任务说明与要求
- `refs/` 目录下的文献摘要：每文件可视为一篇文献的要点

## 输出要求
- 综述需包含：研究背景与动机、主要发现或方法归纳、分类或对比、简要结论与可拓展方向
- 语言简洁、结构清晰，避免无依据的断言
- 若文献不足，在综述中显式说明"当前仅基于有限材料，建议补充更多文献"

## 约束
- 只基于 Collect 收集到的内容进行归纳与撰写，不编造文献
- 综述写入 survey_output.md 文件
""")

    # 创建输出文件（初始为空）
    with open(os.path.join(work_dir, "survey_output.md"), "w", encoding="utf-8") as f:
        f.write("# 文献综述\n\n*由 Agent 自动生成*\n\n")

    # 复制参考文献
    refs_dest = os.path.join(work_dir, "refs")
    os.makedirs(refs_dest, exist_ok=True)

    for ref_file in Path(refs_dir).glob("*.md"):
        shutil.copy(ref_file, os.path.join(refs_dest, ref_file.name))

    # 初始化 git 仓库
    subprocess.run(["git", "init"], cwd=work_dir, check=True, capture_output=True)
    subprocess.run(
        ["git", "config", "user.email", "agent@test.com"],
        cwd=work_dir,
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["git", "config", "user.name", "Survey Agent"],
        cwd=work_dir,
        check=True,
        capture_output=True,
    )
    subprocess.run(["git", "add", "-A"], cwd=work_dir, check=True, capture_output=True)
    subprocess.run(
        ["git", "commit", "-m", "initial: 文献综述工作目录"],
        cwd=work_dir,
        check=True,
        capture_output=True,
    )


def main():
    cfg = load_config()
    server_url = os.environ.get("AGENT_SERVER_URL") or cfg.get(
        "server_url", "http://127.0.0.1:3889"
    )
    api_key = os.environ.get("AGENT_LLM_API_KEY") or cfg.get("api_key", "")
    if not api_key:
        print("错误: 请设置 api_key（agent_chat_config.json 或 AGENT_LLM_API_KEY）")
        sys.exit(1)

    # 健康检查
    try:
        r = requests.get(f"{server_url.rstrip('/')}/health", timeout=5)
        r.raise_for_status()
    except Exception as e:
        print(
            f"无法连接服务 {server_url}，请先启动: cd agent-runtime-core && npm run start:server"
        )
        print("错误:", e)
        sys.exit(1)

    # 获取参考文献目录
    try:
        refs_dir = get_sample_refs_dir()
        print(f"参考文献目录: {refs_dir}")
    except FileNotFoundError as e:
        print(f"错误: {e}")
        sys.exit(1)

    work_dir = tempfile.mkdtemp(prefix="survey_agent_")
    print(f"工作目录: {work_dir}")

    try:
        setup_workspace(work_dir, refs_dir)

        base_url = (cfg.get("base_url") or "").rstrip("/")
        if not base_url:
            base_url = "http://35.220.164.252:3888/v1"

        # 文献综述任务配置
        body = {
            "goal": "根据 /Applications/workspace/ailab/research/agent_runtime_core_final/survey_agent/refs/ 目录下的参考文献撰写一份文献综述，写入 survey_output.md",
            "subgoals": [
                "阅读 AGENTS.md 了解任务要求",
                "收集并阅读所有参考文献摘要",
                "归纳文献的主要主题和方法",
                "撰写综述正文，包含背景、分类、结论和展望",
                "将综述写入 survey_output.md",
            ],
            "workDir": work_dir,
            "collectConfig": {
                "sources": [
                    {"type": "file", "query": "AGENTS.md", "weight": 1.0},
                    {"type": "file", "query": "refs/sample_ref_1.md", "weight": 0.9},
                    {"type": "file", "query": "refs/sample_ref_2.md", "weight": 0.9},
                    {"type": "file", "query": "refs/sample_ref_3.md", "weight": 0.9},
                ],
                "maxTokens": 4000,
            },
            "llm": {
                "baseUrl": base_url,
                "model": cfg.get("model_name", "MiniMax-M2.5"),
                "apiKey": api_key,
            },
            "thresholds": {
                "maxIterations": 20,
                "maxNoProgress": 3,
                "confidenceLow": 0.3,
                "confidenceMid": 0.6,
                "uncertaintyHigh": 0.7,
            },
        }

        print("\n" + "=" * 60)
        print("  文献综述 Agent 启动")
        print("=" * 60)
        print(f"目标: {body['goal']}")
        print(f"子目标数量: {len(body['subgoals'])}")
        print("-" * 60)

        print("调用 POST /run ...")
        resp = requests.post(
            f"{server_url.rstrip('/')}/run",
            json=body,
            timeout=180,
        )
        resp.raise_for_status()
        data = resp.json()

        print("\n" + "=" * 60)
        print("  结果（文献综述 Agent）")
        print("=" * 60)
        print("status:", data.get("status"))
        if data.get("reason"):
            print("reason:", data["reason"])
        state = data.get("state", {})
        print(
            "mode:",
            state.get("mode"),
            "| 迭代:",
            state.get("iterationCount"),
            "| version:",
            state.get("version"),
        )
        print("子目标:", state.get("subgoals"))
        print("trace 条数:", data.get("traceLength", 0))

        print("-" * 60)
        print("Trace 详情:")
        if data.get("traceJson"):
            entries = json.loads(data["traceJson"])
            for e in entries:
                kind = e.get("kind")
                data_item = e.get("data", {})
                if kind == "collect":
                    print(f"  [collect] sources: {data_item.get('sources', [])}")
                    conf = e.get("confidence", {})
                    print(
                        f"         confidence: coverage={conf.get('coverage', 0):.2f}, reliability={conf.get('reliability', 0):.2f}"
                    )
                elif kind == "reason":
                    task = data_item.get("task", "")[:50]
                    print(f"  [reason] task: {task}...")
                    unc = e.get("uncertainty", {})
                    print(f"         uncertainty: score={unc.get('score', 0):.2f}")
                elif kind == "judge":
                    jtype = data_item.get("type")
                    decision = str(data_item.get("decision", ""))[:60]
                    print(f"  [judge] type: {jtype}, decision: {decision}...")
                elif kind == "exec":
                    proposal = str(data_item.get("proposal", ""))[:60]
                    print(f"  [exec] proposal: {proposal}...")
                elif kind == "state":
                    if "modeTransition" in data_item:
                        print(
                            f"  [state] transition: {data_item.get('modeTransition')}"
                        )
                elif kind == "escalate":
                    print(f"  [escalate] reason: {data_item.get('reason', '')}")
                elif kind == "stop":
                    print(f"  [stop] reason: {data_item.get('reason', '')}")

        print("=" * 60)

        # 尝试读取生成的综述文件
        output_file = os.path.join(work_dir, "survey_output.md")
        if os.path.exists(output_file):
            with open(output_file, "r", encoding="utf-8") as f:
                content = f.read()
            print("\n生成的综述文件 (survey_output.md):")
            print("-" * 40)
            print(content[:2000])
            if len(content) > 2000:
                print("\n... (truncated)")
            print("-" * 40)

    except requests.exceptions.RequestException as e:
        print(f"请求错误: {e}")
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"JSON 解析错误: {e}")
        sys.exit(1)
    finally:
        # 保留工作目录以便查看结果（调试用）
        print(f"\n工作目录已保留: {work_dir}")
        print("如需清理，请手动删除该目录")


if __name__ == "__main__":
    main()
