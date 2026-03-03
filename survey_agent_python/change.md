请在本仓库中对 `survey_agent_python` 进行一次结构性精简重构，目标是：

> **实现一个「只需维护 `.agent/AGENT.md` 和 `skills` 就能工作良好」的 Survey Agent**。  
> 业务级的调研 workflow 不再写死在 Python 源码里，而是主要通过 AGENT 配置和 skills 文档来驱动。

具体要求如下：

1. **整体设计目标**

   1.1 保持 `survey_agent_python` 的总体功能不变：  
   - 每次运行执行 Fetcher → Screener → Analyst 三个阶段；  
   - 从 arXiv 抓取论文、基于配置和知识库筛选、下载 PDF、生成总结到 `knowledge_base/{topic}` 并更新 `meta.json`。

   1.2 但实现方式要调整为：  
   - **Python 代码只做「容器 + 接口」**（HTTP API、配置读取、调用 SDK 的薄封装）；  
   - **具体 workflow（阶段顺序、各阶段职责、所用 skills、文件命名约定等）主要写在 `.agent/AGENT.md` 中**，并引用 `skills/*/SKILL.md` 的说明；  
   - 以后业务逻辑修改应优先改 AGENT 和 skills，而不是改 `pipeline.py` 里的控制流。

2. **Workflow 上移到 `.agent/AGENT.md`**

   2.1 在 `.agent/AGENT.md` 中新增一个清晰的「Survey Workflow」章节，建议结构如下（可在现有内容基础上扩展，而不是完全重写）：

   - **Daily Survey Workflow 总览**：  
     - 说明该 Agent 每次运行的高层目标（例如「根据用户主题配置，从 arXiv 获取最新论文，筛选高潜力论文并写入知识库」）；  
     - 指出三大阶段：Fetcher / Screener / Analyst。

   - **Fetcher 阶段**：  
     - 明确：「优先参考 `skills/arxiv_api/SKILL.md`，根据 `config/user_config.json` 中 topics 的 `arxiv_categories` 和调用参数（`max_results`, `start_date`, `end_date` 等）构造抓取命令」；  
     - 指定输出约定：将原始结果写入 `data/raw_papers_{YYYY-MM-DD}.json`；  
     - 可以以步骤或伪代码形式描述调用方式，例如「调用 `skills/arxiv_api/fetch_arxiv.py`，参数为 ...」。

   - **Screener 阶段**：  
     - 明确：「优先参考 `skills/screening/SKILL.md`，读取上一阶段的 `raw_papers`，结合 `config/user_config.json`、`knowledge_base/{topic}/meta.json` 和 `data/blacklist.json` 进行筛选」；  
     - 指定输出约定：写入 `data/selected_papers_{YYYY-MM-DD}.json`，结构沿用 `skills/screening` 的输出格式；  
     - 说明可以按需调用 meta-agent-core SDK 做更智能的筛选（可引用 `skills/screening/SKILL.md` 中的 SDK 示例）。

   - **Analyst 阶段**：  
     - 明确：「对 `selected_papers_*.json` 中的每一篇论文，按如下顺序操作：  
       1）如果本地没有 PDF，则下载至 `data/pdfs/{arxiv_id}.pdf`（可参考 `scripts/download_pdf.py` 或改造为 skill）；  
       2）可选：使用 `skills/pdf_extract/` 将 PDF 转成可读文本文件；  
       3）使用 meta-agent-core SDK 和 `skills/writing/` 生成论文总结，写入 `knowledge_base/{topic}/paper_{arxiv_id}.md` 并更新 `meta.json`。」  
     - 指出 CollectConfig 的典型组成：`templates/paper_summary.md`、对应 topic 的 `meta.json`、PDF 或提取出的文本文件、`skills/writing/SKILL.md` 等。

   2.2 在该章节中强调：  
   - **Python 只负责提供必要的工具/脚本和目录结构**，真正的「先做什么，再做什么」应该由 Agent 在 Plan/Execute 阶段，参考 AGENT.md + skills 自己推理出来。

3. **精简/删除冗余 Python Workflow 代码**

   3.1 审视并精简 `survey_agent_python/pipeline.py`：  
   - 当前文件中有一套完整的 `Pipeline` 控制流（Fetcher/Screener/Analyst）实现；  
   - 请尽量**移除这套硬编码 workflow**，保留的代码仅限于「方便复用的通用工具/封装」（如果确有必要），或者直接删除整个 `pipeline.py`，视最终设计而定；  
   - 删除前请把其中有价值的逻辑（例如参数组合、路径约定）吸收进 `.agent/AGENT.md` 和 `skills/*/SKILL.md` 中的说明，而不是再写进别的 Python 文件。

   3.2 处理 `api_server.py` 中的重复逻辑：  
   - 目前 `api_server.py` 里的 `run_pipeline_thread` 函数又写了一遍 Fetcher/Screener/Analyst 的流程（包括子进程调用脚本、循环分析论文等）；  
   - 请重构为：  
     - 保留现有 REST API 形状（尤其是 `/api/run/trigger` 的请求参数：`start_date`, `end_date`, `max_results`, `research_query` 等）；  
     - 但在内部实现中，不再手写 3 个阶段的控制流，而是统一调用一个新的「Agent 运行入口」，该入口通过 `MetaAgentSDK.run(...)` 触发 meta-agent-core，根据 `.agent/AGENT.md` + skills 完成整个 workflow；  
     - 该入口可以定义在一个小的辅助模块（比如 `runner.py`）或直接在 `api_server.py` 内部，核心思想是：  
       - 构造高层 `goal`（例如「根据当前配置执行一次完整的 Survey Workflow」）；  
       - 构造 `collectConfig.sources`，包含：  
         - 所需模板文件（如 `templates/paper_summary.md`）；  
         - 相关 topic 的 `knowledge_base/{topic}/meta.json`；  
         - 所有相关 `skills/*/SKILL.md`；  
       - 传入当前工作目录 `workDir=str(BASE_DIR)` 与 LLM 配置，剩下交给 meta-agent-core Agent 自行调度。

   3.3 统一 Fetcher/Screener/Analyst 的代码归属：  
   - 优先以 `skills/` 为唯一的实现位置：  
     - `skills/arxiv_api/fetch_arxiv.py` 负责抓取；  
     - `skills/screening/screen_papers.py` 负责筛选；  
     - `skills/pdf_extract/extract_text.py` 负责 PDF 转文本；  
     - `skills/writing` 负责写作逻辑与模板说明。  
   - 如果 `scripts/` 目录下存在与上述 skills 完全重复功能的脚本，请合并/迁移后删除重复版本，只保留一份实现；  
   - 不要删除用户的数据文件和知识库内容（`data/*.json`, `knowledge_base/*/paper_*.md` 等），仅清理明显的代码冗余。

4. **保持对外接口和目录结构尽量兼容**

   4.1 `api_server.py` 的公开 API 路由（比如 `/api/topics`, `/api/papers/{arxiv_id}`, `/api/run/status`, `/api/run/trigger`, `/api/run/stream`, `/api/papers/{arxiv_id}/feedback` 等）在路径和主要参数上保持兼容，除非有充分理由需要调整。

   4.2 目录和文件命名保持不变，特别是：  
   - `knowledge_base/{topic}/meta.json` 与 `paper_{arxiv_id}.md` 的命名方式；  
   - `data/raw_papers_{YYYY-MM-DD}.json` 与 `data/selected_papers_{YYYY-MM-DD}.json`；  
   - `data/pdfs/{arxiv_id}.pdf` 和可能的 `data/pdfs/{arxiv_id}.txt`。  

   4.3 如有必要新增极少量辅助函数/模块，请确保命名清晰、职责单一，不再引入新的「mini-pipeline」。

5. **文档与设计原则更新**

   5.1 完成代码修改后，请同步更新以下文档，使描述与实现保持一致：

   - `survey_agent_python/README.md`：  
     - 强调新的「AGENT.md + skills 驱动 workflow」设计；  
     - 删除或更新里面对 `pipeline.py`、旧脚本路径等已经不准确的描述；  
     - 简要说明如何通过编辑 `.agent/AGENT.md` 和 `skills/*/SKILL.md` 来定制 Survey Agent 行为。

   - `meta-agent-core/agent-design-principles-merged.md`：  
     - 在合适的位置补充一个小节，作为本案例，说明如何把业务 workflow 放入 AGENT.md，而让运行时容器只做薄封装；  
     - 说明 skills 作为「可组合能力单元」参与 CollectConfig 与 workflow 设计的理念。

   5.2 更新完文档后，请快速检查仓库中与 `survey_agent` / `survey_agent_html` 相关的旧说明，避免出现「指向已经删除或重命名文件」的死链。

6. **质量要求与自检**

   6.1 确保修改后的 Python 代码能正常运行基础流程（在本地假设 meta-agent-core 服务可用的前提下）：  
   - 至少手动调用一次 `/api/health` 与 `/api/run/trigger`，确认基本逻辑无明显错误（可通过日志或简单日志打印来验证）。

   6.2 保持代码风格和现有项目一致，必要时运行已有的 linter/格式化工具，并修复因本次改动引入的新问题。

   6.3 在 `.agent/AGENT.md` 中避免冗长的重复说明：  
   - 对已经在 `skills/*/SKILL.md` 中详述的内容，可以用「引用」和高层总结的方式，避免两边都维护复杂细节。

完成上述改造后，`survey_agent_python` 应该满足：  
- 对使用者而言，主要只需要编辑 `.agent/AGENT.md` 和 `skills/*/SKILL.md` 即可理解和定制 workflow；  
- Python 代码层只承担运行时容器、接口暴露与少量胶水逻辑的职责，实现尽可能简洁。


完成任务后，帮我更新meta-agent-core/agent-design-principles-merged.md和survey_agent_python/README.md文档，使得项目和描述一致。
