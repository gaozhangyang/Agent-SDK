# Survey Agent

> 本文件定义了 Survey Agent 的静态上下文，是 Agent 启动时自动加载的 AGENT.md。

## 目标

自动化学术文献检索与知识管理：每日从 arXiv 获取最新论文，根据用户预设的研究兴趣主题筛选高潜力论文，将论文总结写入对应的知识板块。

## 核心能力边界

- **Fetcher**: 从 arXiv API 抓取指定分类的最新论文
- **Screener**: 基于用户兴趣配置和知识库关键词筛选论文
- **Analyst**: 阅读并总结论文核心贡献，写入知识板块

## 项目结构

```
survey_agent/
├── .agent/                    # 运行时日志
│   ├── state.json            # State 快照
│   ├── trace.jsonl           # 推理轨迹（JSON 格式）
│   ├── terminal.md          # 终端执行日志（Markdown 格式）
│   └── memory.jsonl          # 长期记忆
├── AGENT.md                  # 静态上下文（团队共享）
├── skills/                   # 技能目录
│   ├── arxiv_api.md         # arXiv API 使用指南
│   ├── screening.md         # 论文筛选工具说明
│   └── writing.md           # 论文总结写作指南
├── knowledge_base/           # 知识板块目录
│   └── {topic}/
│       ├── meta.json         # 板块元信息
│       └── paper_*.md        # 论文总结
├── data/                    # 运行时数据
│   ├── raw_papers_*.json    # 原始抓取数据
│   └── selected_*.json      # 筛选后数据
├── scripts/                 # 工具脚本
│   ├── fetch_arxiv.py       # 论文抓取
│   └── screen_papers.py     # 论文筛选
└── config/
    └── user_config.json     # 用户配置
```

## Collect 检索配置

Survey Agent 使用 `Collect` 协议获取上下文。检索范围明确包括：

| 来源类型 | 说明 | 典型用途 |
|---------|------|---------|
| file | 读取指定文件 | 模板、知识库文档 |
| trace_tag | 按标签过滤 Trace 历史 | 获取特定类型的推理记录 |
| skills | 从 skills/ 目录检索技能文档 | 获取工具使用说明、最佳实践 |

**注意：** Memory（长期记忆）在子目标完成时自动记录，通过 `memory.search(query)` 方法检索，不通过 Collect 协议。

### Collect 配置示例

```json
{
  "sources": [
    { "type": "file", "query": "templates/paper_summary.md", "weight": 1.0 },
    { "type": "trace_tag", "query": "fetcher", "weight": 0.8 },
    { "type": "skills", "query": "arxiv_api", "weight": 1.0 }
  ]
}
```

### Skills 目录结构

```
skills/
├── arxiv_api.md        # arXiv API 使用指南
├── screening.md        # 论文筛选工具说明
└── writing.md          # 论文总结写作指南
```

## Mode 状态机

遵循 `agent-design-principles-v2.md` 的标准 Mode 状态机：

```
plan     → execute    # 方案通过 Judge(risk)
execute  → review     # 当前批次动作完成
review   → plan       # 目标变化或需重新规划
任意      → recovery  # 连续失败 / 快照失败
任意      → paused    # Interrupt 信号到达
```

## 权限级别

- Level 1: 受控写（write/edit 限 workspace）
- Level 2: 受控执行（bash 常规命令）

## 运行时约束

1. 每次运行绑定 `survey_agent/` 目录
2. Trace、Terminal Log、Memory 追加写到 `.agent/` 目录
3. Session 恢复：检测 `.agent/state.json` 是否存在，存在则恢复
4. AGENT.md 作为静态上下文，在每次 LLMCall 时自动注入

## 运行时配置

以下配置可在 AGENT.md 中定义：

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| maxOutputLength | Terminal Log 输出截断长度（字节） | 102400 (100KB) |

配置示例（```json 格式）：

```json
{
  "maxOutputLength": 204800,
  "strategies": {
    "level": "L1",
    "mode_fsm": "enabled",
    "permission_fsm": "enabled",
    "harness": "standard",
    "error_classifier": "enabled",
    "judge": {
      "outcome": "required",
      "risk": "enabled",
      "milestone": "enabled",
      "capability": "enabled",
      "selection": "disabled"
    }
  }
}
```

### 策略层配置说明

| 策略项 | 说明 | 可选值 |
|--------|------|--------|
| level | 基础策略包，决定默认启用范围 | L0, L1, L2, L3 |
| mode_fsm | Mode 状态机（Plan/Execute/Review/Recovery/Paused） | enabled, disabled |
| permission_fsm | 权限状态机（Level 0-4） | enabled, disabled |
| harness | 快照策略 | standard, aggressive, disabled |
| error_classifier | 错误分类（retryable / logic / environment / budget） | enabled, disabled |
| judge.outcome | Loop 终止收敛（不可关闭，可降级为 rule_based） | required, rule_based, disabled |
| judge.risk | 高权限操作门卫 | enabled, disabled |
| judge.milestone | git commit 时机判断 | enabled, disabled |
| judge.capability | 启动时能力边界声明 | enabled, disabled |
| judge.selection | 多候选仲裁 | enabled, disabled |
