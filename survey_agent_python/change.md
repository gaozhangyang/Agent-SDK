请在本仓库中对 `survey_agent_python` 进行第二轮精简，达成以下两点目标：

---

## 目标一：初始化形态只保留最少必要项，且 global_settings 进入 AGENT.md

**1.1 最小项目骨架**

初始化/克隆后，项目根目录**只保留**以下内容（作为「最小 Agent 项目」的标配）：

- `.agent/`：内含 `AGENT.md` 等（运行时状态文件如 state.json、trace.jsonl 等可在首次运行后生成）
- `skills/`：各技能目录及 SKILL.md、脚本
- `README.md`：项目说明与使用方式
- **一个入口 Python 脚本**：见目标二，命名为 `run.py`（表示「运行一次 Agent」），不再以 Web 服务形态存在

**1.2 配置迁移：global_settings + topics → AGENT.md**

- 将当前 `config/user_config.json` 中的 `global_settings` **以及 `topics` 列表**全部迁移到 `.agent/AGENT.md` 中，作为「运行时配置」的一部分（不再单独维护 topics 配置文件）。
- 在 AGENT.md 中已有的「运行时配置」```json 块内**扩展**以下字段（或等价结构），并保留现有 strategies 等配置不变：
  - `llm`: `{ "baseUrl", "model", "apiKey" }`（apiKey 可为空字符串，见下）
  - `sdk_url`: meta-agent-core 服务地址（如 `http://127.0.0.1:3890`）
  - `fetch_max_papers`: 单次最大抓取篇数
  - `screening_threshold`: 筛选相关度阈值
  - `pdf_download_dir`: PDF 下载目录（如 `data/pdfs`）
  - `debug`: 是否调试模式
  - 其他原 global_settings 中与运行相关的项也一并迁入
- **敏感信息**：`llm.apiKey` 在 AGENT.md 中可写占位或空字符串；**运行时必须支持通过环境变量覆盖**（如 `LLM_API_KEY`），并在 README 中说明，避免密钥进仓库。
- 迁移完成后，**删除整个** `config/user_config.json` 文件，不再保留任何独立的 global_settings 或 topics 配置文件；后续如需修改主题或运行参数，一律通过编辑 AGENT.md 完成。

**1.3 其他文件与目录**

- **SDK 调用逻辑**：本项目为了降低心智负担，**不再保留单独的 `sdk_client.py` 模块**，而是在 `run.py` 中内联一段最小可用的 SDK 调用逻辑（基于 `requests.post` 调用 meta-agent-core 的 `/run` 接口即可），只实现当前 Survey Workflow 所需的能力（无需保留流式、interrupt 等高级特性），让用户打开 `run.py` 即能看懂「如何调用 meta-agent-core」。
- **templates/**、**knowledge_base/**、**data/**：可不作为「初始化必含」清单；在 README 中说明运行时会创建或使用这些目录即可；若现有 skills 或 workflow 依赖其中文件，保留并在 README 中注明。
- 删除与「最小骨架」无关的冗余文件（例如若存在多余的脚本或已废弃的 pipeline 入口）。

---

## 目标二：入口脚本改为「普通 Python 项目」形态，便于调试与学习

**2.1 不做 Web 服务**

- **移除** FastAPI、uvicorn 及所有 HTTP 路由（如 `/api/run/trigger`、`/api/run/stream`、`/api/topics` 等）。
- **移除** SSE、多线程跑 pipeline、后台线程等与「网页后台」相关的逻辑。
- 当前若存在 `api_server.py`，请**改造成**或**替换为**下面描述的单一入口脚本；若保留文件名 `api_server.py`，则其语义应改为「运行入口」而非「HTTP 服务」。

**2.2 单一入口、CLI 友好、易调试**

- 提供**一个**可直接执行的 Python 入口（建议命名为 `run.py`），行为为：
  - **无参数执行**：`python run.py` 表示执行一次完整的 Survey Workflow（与当前「触发一次 pipeline」等价）。
  - **可选命令行参数**：支持常用覆盖项，例如：
    - `--max-results`：本次最大抓取篇数
    - `--start-date` / `--end-date`：日期范围（YYYYMMDD）
    - `--research-query`：研究关键词（若有用于筛选的 query）
    - 其他与 AGENT.md 中 workflow 一致的参数可按需增加
  - 入口脚本应：**仅从 AGENT.md** 中解析运行配置（含原 global_settings 与 topics），构造 goal 与 collectConfig，调用 meta-agent-core（通过在 `run.py` 内部封装的最小 SDK 调用函数即可），并打印简要日志（如「开始执行 Survey Workflow」「goal=…」「SDK 调用完成」等），便于在 IDE 中打断点、单步调试和直接运行。
- **不启动任何 HTTP 服务**；使用方式仅为在终端执行 `python run.py [选项]` 或在 IDE 中运行该脚本。

**2.3 与现有设计的衔接**

- Workflow 逻辑仍以 **AGENT.md + skills** 为准；入口脚本只负责：读配置、组 goal、组 collectConfig、调 SDK、输出简单状态。
- 若当前已有从 AGENT.md 解析配置的逻辑，请复用并改为从 AGENT.md 的配置块读取原 `global_settings` 内容；若当前仍从 `user_config.json` 读 global_settings，则改为从 AGENT.md 读取。

---

## 收尾与文档

- **README.md**：更新为与上述设计一致。说明：
  - 本项目为**普通 Python 项目**，通过 `python run.py` 运行，无 Web 服务；
  - 配置（含 LLM、SDK 地址、抓取/筛选参数等）在 **AGENT.md** 中维护，apiKey 可通过环境变量覆盖；
  - 项目最小骨架为 `.agent/`、`skills/`、`README.md`、`run.py`，topics 与 global_settings 均在 AGENT.md 中统一维护。
- **meta-agent-core/agent-design-principles-merged.md**：若合适，可补充一句说明「Survey Agent 示例采用仅 AGENT.md + skills + 单入口脚本的极简结构，配置集中在 AGENT.md」，与当前实现保持一致即可。

完成上述修改后，`survey_agent_python` 应满足：

- 初始化/克隆后只需关心 **.agent、skills、README.md 和一个入口脚本**；
- **global_settings 全部在 AGENT.md 中**，无独立 user_config.json 的 global_settings；
- 以**最方便调试、学习、使用的正常 Python 项目**方式运行，无网页后台。

需要严格测试每个模块和端到端测试run.py，最后更新survey_agent_python/README.md和meta-agent-core/agent-design-principles-merged.md，使得项目状态和描述一致