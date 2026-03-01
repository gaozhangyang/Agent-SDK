# Agent Runtime Core SDK

> 基于《Coding Agent 设计原则分级指南》L0 + L1 的最简约实现方案

本 SDK 是一个面向 opencode 场景的系统集成级 SDK，提供了完整的 Agent 运行时核心能力。

## 特性

- **四个执行原语** (L0.1): `read`, `write`, `edit`, `bash`
- **LLM 推理引擎** (L0.2): `Reason` (发散生成) + `Judge` (收敛裁决)
- **上下文编排** (L0.3): `Collect` 协议，支持多来源信息收集
- **核心执行循环** (L0.4): 完整的 Agent 循环，支持 Plan → Execute → Review 模式
- **版本快照** (L0.6): 基于 Git 的 Harness，自动版本控制
- **状态管理** (L1.1 + L1.2): 权限状态机 + Mode 状态机

## 快速开始

### 安装

```bash
cd agent-runtime-core
npm install
```

### 运行测试

```bash
npm test
```

### 运行端到端示例

```bash
npm run example
```

### 启动 HTTP 服务（供 Python 等客户端调用）

内部 `import` 本 SDK，对外暴露 HTTP 接口：

```bash
npm run start:server
```

默认监听 `http://0.0.0.0:3889`，可通过环境变量 `PORT` 修改。

- **GET /health** — 健康检查，响应 `{ "status": "ok", "service": "agent-runtime-core" }`
- **POST /run** — 执行一次 Agent 循环。请求体：`goal`（必填）、`subgoals`（可选）、`workDir`（必填，需为 git 仓库）、`collectConfig`（必填，含 `sources`）、`llm`（必填：`baseUrl`、`model`、`apiKey`）、`thresholds`（可选）。响应：`status`（`completed` | `escalated` | `budget_exceeded`）、`reason`（仅 escalate 时）、`state`、`traceJson`、`traceLength`。  
  `collectConfig.sources` 每项为 `{ type: 'file'|'bash'|'trace_tag', query: string, weight?: number }`；`file` 的 `query` 可为相对路径（相对 `workDir` 解析）。

在上级目录用 Python 调用时，先启动本服务，再运行 `python client_http.py`（需在 `agent_chat_config.json` 中配置 `api_key`，可选 `server_url`，默认 `http://127.0.0.1:3889`）。

## 项目结构

```
agent-runtime-core/
├── src/
│   ├── trace.ts        # Trace 追踪系统
│   ├── primitives.ts   # 四个执行原语
│   ├── llm.ts          # LLM 调用 (Reason/Judge)
│   ├── collect.ts      # 上下文收集
│   ├── harness.ts      # 版本快照
│   ├── state.ts        # 状态管理
│   ├── loop.ts         # 核心执行循环
│   ├── server/         # HTTP 服务（封装 SDK，供远程调用）
│   │   ├── index.ts
│   │   └── primitives.ts
│   └── index.ts        # SDK 入口
├── tests/              # 单元测试
├── example/            # 端到端示例
└── package.json
```

## 使用教程

### SDK 能做什么

本 SDK 提供完整的 Agent 运行时核心能力，可直接在 Node 中调用，也可通过内置 HTTP 服务被 Python 等语言调用：

- **执行循环**：按「Collect → Plan(Reason) → Judge(risk) → Execute → Review(Judge outcome)」自动推进，直到目标完成、升级（Escalate）或预算耗尽。
- **上下文收集 (Collect)**：从文件、bash 命令、Trace 标签等多来源拉取内容，得到带置信度（coverage/reliability）的 context。
- **推理与裁决**：Reason 生成提案，Judge 按类型（outcome/risk/selection）做收敛裁决，所有不确定性写入 Trace。
- **版本快照 (Harness)**：在执行前对工作目录做 git 快照，失败则阻断执行；支持按需回退。
- **状态与模式**：维护 goal/subgoals、Plan / Execute / Review / Recovery 模式及切换规则，终止条件显式检查。

### 通过 client_http.py 调用 SDK（推荐测试方式）

通过 HTTP 服务调用 SDK 时，用上级目录的 Python 脚本即可完成一次完整循环的测试。

**1. 启动 HTTP 服务**（在本仓库根目录 `agent-runtime-core` 下）：

```bash
npm run start:server
```

**2. 配置 LLM**  
在上级目录 `agent_runtime_core_final` 下创建或编辑 `agent_chat_config.json`，至少包含 `api_key`；可选 `base_url`、`model_name`、`server_url`（默认 `http://127.0.0.1:3889`）。例如：

```json
{
  "base_url": "http://your-llm-api/v1/",
  "model_name": "Your-Model",
  "api_key": "your-api-key",
  "server_url": "http://127.0.0.1:3889"
}
```

**3. 运行测试案例**（在 `agent_runtime_core_final` 下）：

```bash
python client_http.py
```

脚本会：对服务做健康检查 → 创建临时工作目录（含 `AGENTS.md`、`sample.txt` 并 `git init`）→ 向 `POST /run` 提交一次任务（目标：阅读上下文并一句话总结）→ 打印返回的 `status`、`state`、Trace 条数与摘要。

**预期**：若服务与 LLM 均正常，可看到 `status: completed`（或 `escalated`/`budget_exceeded`），以及若干条 `collect`、`reason`、`judge`、`exec`、`state` 等 Trace 记录，即表示通过 HTTP 成功调用本 SDK 完成了一轮 Agent 循环。

### 在 Node 中直接调用

在 TypeScript/Node 中可直接 `import` 本 SDK，传入 `LLMProvider`、工作目录、`collectConfig` 等运行 `runLoop`。完整可运行示例见 `example/run.ts`，运行：

```bash
npm run example
```

阈值、数据来源、Mode 状态机、Trace 用法等说明见下方「API 参考」与「设计原则」。

## API 参考

### runLoop 与配置

`runLoop(state, config, primitives, llm, trace, harness)` 的 `config.thresholds` 常用字段：`confidenceLow`(0.2)、`confidenceMid`(0.5)、`uncertaintyHigh`(0.75)、`maxIterations`(50)、`maxNoProgress`(3)、`maxCollectRetry`(3)。`collectConfig.sources` 每项为 `{ type: 'file'|'bash'|'trace_tag', query: string, weight?: number }`。

### Trace

```typescript
class Trace {
  append(entry: TraceEntry): void;
  filterByTag(tag: string): TraceEntry[];
  all(): TraceEntry[];
  serialize(): string;
  length(): number;
  clear(): void;
}
```

### LLMCall

```typescript
class LLMCall {
  constructor(provider: LLMProvider);
  
  // 发散生成
  reason(context: string, input: string): Promise<LLMCallResult>;
  
  // 多候选生成
  reasonMulti(context: string, input: string, n?: number): Promise<LLMCallMulti>;
  
  // 收敛裁决
  judge(type: 'outcome' | 'risk' | 'selection', context: string, input: string): Promise<LLMCallResult>;
}
```

### Harness

```typescript
class Harness {
  constructor(primitives: Primitives, workDir: string);
  
  // 创建快照
  snapshot(label: string): Promise<boolean>;
  
  // 回退到上一个快照
  rollback(): Promise<boolean>;
  
  // 检查是否是 git 仓库
  isGitRepo(): Promise<boolean>;
}
```

## 设计原则

本 SDK 严格遵循《Coding Agent 设计原则分级指南》:

- **原语接口冻结**: 四个执行原语签名永不改变
- **Collect 是编排协议**: 复杂性收敛于此，不外溢
- **终止条件是一等概念**: 循环开头先检查终止条件
- **Judge 必须显式 type**: `outcome` | `risk` | `selection`
- **质量信号写入 Trace**: 所有 confidence 和 uncertainty 统一记录

## 许可证

MIT
