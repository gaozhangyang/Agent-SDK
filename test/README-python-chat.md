# Python 与 Agent Runtime Core 的两种使用方式

## 方式一：HTTP 调用 SDK（推荐）

Node 侧提供 HTTP 服务，内部 `import` agent-runtime-core SDK；Python 通过 `requests` 调用该服务，真正跑完整 Agent 循环（Collect / Plan / Execute / Review）。

1. **启动 Node 服务**（在 `agent-runtime-core` 目录）：
   ```bash
   cd agent-runtime-core && npm install && npm run start:server
   ```
2. **运行 Python 客户端**：
   ```bash
   python client_http.py
   ```
   - 配置：同目录 `agent_chat_config.json`（或环境变量）
   - 可配置 `server_url`（默认 `http://127.0.0.1:3889`）、`base_url`、`model_name`、`api_key`

详见 `agent-runtime-core/README.md` 中「启动 HTTP 服务」一节。

---

## 方式二：仅验证 LLM 对话（不经过 SDK）

用于在不依赖 Node 的前提下，验证与 **agent-runtime-core SDK** 一致的 LLM 对话流程能否跑通（Reason + Judge）。不执行完整循环，仅调用 LLM 的 Reason + Judge。

## 运行前准备

1. 安装依赖：
   ```bash
   pip install -r requirements-agent-chat.txt
   ```

2. 配置 LLM（二选一）：
   - **推荐**：在同目录下创建 `agent_chat_config.json`（已被 .gitignore，不会提交）：
     ```json
     {
       "base_url": "http://35.220.164.252:3888/v1/",
       "model_name": "MiniMax-M2.5",
       "api_key": "你的API密钥",
       "server_url": "http://127.0.0.1:3889"
     }
     ```
     - `server_url` 仅用于 **client_http.py**（HTTP 调用 SDK 服务）；**test_agent_chat.py** 只用 base_url / model_name / api_key。
   - 或使用环境变量：`AGENT_LLM_API_KEY`、`AGENT_SERVER_URL` 等

## 运行

```bash
python test_agent_chat.py
```

脚本会依次调用：
- **Reason**：根据 context + task 生成提案，并解析 `uncertainty`
- **Judge(risk)**：对提案做“是否允许执行”的裁决

若输出中出现「对话验证完成：Reason + Judge 调用成功」，即表示与 SDK 的 LLM 调用语义一致、且能成功对话。

## 与 SDK 的关系
- **client_http.py** 通过 HTTP 调用 Node 封装的 SDK 服务，会跑完整 Agent 循环（Collect、Loop、Harness 等）。
- 也可直接运行 Node 示例：`cd agent-runtime-core && npm run example`。
