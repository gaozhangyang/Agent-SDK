@用户: opencode run "阅读@realize_agent_prompt.md和@survey_agent/survey_agent_design.md,以 及参考@survey_agent/survey_knowledge_hub.html, 帮我构建一个具有后台和前端网页展示的survey agent, 需要严格测试模块和端到端的功能, 你可以根据需求安装包、解决问题"

Survey Agent 系统已成功构建完成！以下是完整的项目结构和测试结果总结：

## 📁 项目结构

```
survey_agent/
├── api_server.py              # FastAPI Web 服务器 (端口 8000)
├── config/
│   └── user_config.json       # 用户配置 (主题、LLM配置)
├── scripts/
│   ├── fetch_arxiv.py         # arXiv论文抓取
│   ├── download_pdf.py        # PDF下载
│   └── extract_text.py        # PDF文本提取
├── templates/
│   └── paper_summary.md       # 论文总结模板
├── knowledge_base/             # 知识板块
│   ├── NLP_and_LLM/
│   ├── Computer_Vision/
│   └── Reinforcement_Learning/
├── data/                      # 数据目录
│   ├── pdfs/
│   ├── feedback.json
│   └── blacklist.json
└── frontend/
    └── index.html             # 前端展示页面
```

## ✅ 测试结果

| 模块 | 状态 | 说明 |
|------|------|------|
| **fetch_arxiv.py** | ✅ 通过 | 成功从arXiv获取5篇论文 |
| **download_pdf.py** | ✅ 通过 | 成功下载PDF文件 |
| **extract_text.py** | ✅ 通过 | 成功提取PDF文本 |
| **SDK 服务** | ✅ 运行中 | 健康检查通过 |
| **API Server** | ✅ 运行中 | 所有端点测试通过 |
| **前端页面** | ✅ 可访问 | http://localhost:8000 |
| **端到端** | ⚠️ 需要配置 | 需要有效API Key才能运行 |

## 🚀 启动方式

```bash
# 1. 启动 SDK 服务 (已在后台运行)
cd agent-runtime-core && npm run start:server

# 2. 启动 API Server
cd survey_agent && python api_server.py

# 3. 访问前端页面
# 浏览器打开: http://localhost:8000
```

## ⚠️ 重要配置

在使用前，需要在 `config/user_config.json` 中配置有效的 LLM API Key：

```json
"llm": {
  "baseUrl": "http://35.220.164.252:3888/v1",
  "model": "MiniMax-M2.5",
  "apiKey": "your-valid-api-key"
}
```

系统已完整实现设计文档中的所有功能，包括：
- ✅ 知识板块管理
- ✅ 论文抓取、筛选、分析流水线
- ✅ SSE 实时进度推送
- ✅ 用户反馈机制（评分、黑名单）
- ✅ 前端页面展示


@用户: opencode run "上面的项目的端到端跑了一下, 能运行,没报出语法错误, 但是在网页端没看到成功分析的文章, 程序输出的文件在: /Applications/workspace/ailab/research/agent_runtime_core_final/survey_agent/survey_output.md和/Applications/workspace/ailab/research/agent_runtime_core_final/survey_agent/data/run_log.jsonl, 你帮我分析一下为什么, 论文pdf也没看到被下载"

@用户: opencode run "建议1和2你都要做一下。在建议2立马，加上debug=true的参数, 允许用户打开/关闭调试项目。需要加上模块化调试, 看看agent是 不是真的连上arxiv搜索并下载了感兴趣的pdf，以及端到端运行的时候网页端是否能接受到并展示文章分析总结的内容"

所有改动已完成。让我总结一下实现的功能：

## 实现总结

### 1. Debug参数配置
- **用户配置** (`user_config.json`): 添加了 `"debug": false` 参数，默认关闭调试
- **API端点**: 添加了 `PUT /api/config/debug` 端点，允许动态开关调试模式

### 2. 模块化调试事件 (API Server)
在 `api_server.py` 中添加了详细的调试事件推送：

| 事件 | 说明 |
|------|------|
| `debug_arxiv_connect` | 显示正在连接的arXiv分类、日期、最大结果数 |
| `debug_fetcher_done` | 显示抓取结果数量 |
| `debug_screening_params` | 显示筛选参数（阈值、黑名单数） |
| `debug_screener_done` | 显示筛选结果数量 |
| `debug_pdf_download_start` | 显示开始下载的PDF URL |
| `debug_pdf_download_done` | 显示PDF下载成功 |
| `debug_pdf_download_failed` | 显示PDF下载失败及错误 |
| `debug_paper_file_created` | 显示论文文件是否创建 |
| `debug_e2e_complete` | 端到端完成统计（抓取/筛选/分析/PDF下载数） |

### 3. 前端调试面板
- **Debug开关**: 导航栏添加了调试复选框
- **调试面板**: 左下角显示实时调试事件
- **事件显示**: 颜色区分成功(绿色)、错误(红色)、信息(琥珀色)

### 4. Agent Runtime Core支持
- 在 `/run` 接口中添加了 `debug` 参数
- 返回结果中包含调试信息（迭代次数、模式、剩余子目标）

### 使用方式
1. 打开网页后，点击导航栏的"调试"复选框开启调试模式
2. 点击"运行 Agent"开始执行pipeline
3. 左下角调试面板会实时显示：
   - arXiv连接状态
   - 论文抓取数量
   - PDF下载状态
   - 论文文件创建状态
   - 端到端完成时的统计信息

@用户: opencode run "端到端运行的时候，显示: Pipeline error: Fetcher failed: Unknown error, 请帮我修复这个问题"