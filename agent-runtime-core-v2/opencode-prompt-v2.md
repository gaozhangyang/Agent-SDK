# OpenCode Prompt：Meta Agent Runtime Core SDK v2 实现任务

---

## 背景说明

本任务是在 v1（`agent-runtime-core-sdk.md`）基础上，按照新设计原则（`agent-design-principles-v2.md`）
实现 v2 版本。**v1 的代码已经可用**，请在实现 v2 时参考 v1 的具体实现，
尤其是 TypeScript 细节、测试写法和 example 的 LLM 接入方式。

v2 相对 v1 的核心变化：
1. 分层从"必要性四级"改为"职责稳定性三层"（核心层 / 编排层 / 策略层）
2. Loop 骨架通过 Hooks 与策略解耦，不再内置 Mode 逻辑
3. Trace 拆分为双流：`Trace`（推理书）+ `TerminalLog`（执行终端）
4. 新增 `InterruptChannel`（用户实时打断）
5. 新增 `StateManager`（Session 持久化与跨 Session 恢复）
6. 新增三个标准 Hook 模块（Mode 状态机 / 权限检查 / 错误分类）
7. `JudgeType` 新增 `'capability'` type

---

## 第一步：阅读文档

**在写任何代码之前，完整阅读以下两份文档：**

1. `agent-design-principles-v2.md`（设计原则，v2 版本）
2. `agent-runtime-core-sdk.md`（v1 实现参考）

阅读完毕后，输出一段 100 字以内的理解摘要，确认你理解了三层架构的分工和 v2 相对 v1 的变化，然后开始编码。

---

## 第二步：项目初始化

```bash
mkdir meta-agent-core && cd meta-agent-core
npm init -y
npm install typescript ts-node @types/node
npm install --save-dev jest ts-jest @types/jest
npx tsc --init --target ES2022 --module commonjs --strict --outDir dist --rootDir src
mkdir -p src/core src/runtime src/hooks tests example
```

在 `package.json` 中加入：
```json
"scripts": {
  "build":          "tsc --noEmit",
  "test":           "jest --testPathPattern=tests/",
  "test:coverage":  "jest --coverage",
  "example":        "ts-node example/run.ts"
}
```

在 `jest.config.js` 中加入：
```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
};
```

---

## 第三步：目录结构（严格按此创建）

```
meta-agent-core/
├── src/
│   ├── core/
│   │   ├── primitives.ts      # 4 个原语 + 路径白名单
│   │   ├── llm.ts             # LLMCall（Reason / Judge）+ LLMProvider 接口
│   │   ├── trace.ts           # Trace + TerminalLog 双流，追加写 .jsonl
│   │   └── collect.ts         # Collect 骨架（file / bash / trace_tag）
│   ├── runtime/
│   │   ├── state.ts           # AgentState + StateManager（持久化）
│   │   ├── harness.ts         # Harness 骨架（snapshot / rollback）
│   │   ├── interrupt.ts       # InterruptChannel（内存队列）
│   │   └── loop.ts            # Loop 骨架 + LoopHooks 接口 + 终止条件
│   ├── hooks/
│   │   ├── mode-state-machine.ts  # Mode 切换规则（标准 Hook 实现）
│   │   ├── permission-guard.ts    # 权限检查（标准 Hook 实现）
│   │   └── error-classifier.ts   # 错误四分类（标准 Hook 实现）
│   └── index.ts               # 对外入口 + createMetaAgent 工厂
├── tests/
│   ├── core/
│   │   ├── primitives.test.ts
│   │   ├── llm.test.ts
│   │   ├── trace.test.ts
│   │   └── collect.test.ts
│   ├── runtime/
│   │   ├── state.test.ts
│   │   ├── harness.test.ts
│   │   ├── interrupt.test.ts
│   │   └── loop.test.ts
│   ├── hooks/
│   │   ├── mode-state-machine.test.ts
│   │   ├── permission-guard.test.ts
│   │   └── error-classifier.test.ts
│   └── integration.test.ts
├── example/
│   └── run.ts                 # 端到端真实 LLM 调用
└── package.json
```

---

## 第四步：各文件实现规格

每个文件顶部必须有一行注释，标明对应的设计层和模块，例如：
```typescript
// [核心层 / 原语] core/primitives.ts — 四个执行原语，接口永不修改
```

---

### `src/core/primitives.ts` ★ 接口签名冻结

```typescript
export interface Primitives {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  edit(path: string, old: string, next: string): Promise<void>;
  bash(command: string): Promise<string>;
}
```

**实现要求：**
- `localPrimitives` 是工厂函数，签名：`localPrimitives(coreDir: string, terminalLog: TerminalLog): Primitives`
- `write` 和 `edit` 在执行前检查目标路径是否在 `coreDir` 下，如果是则抛出 `Error('write/edit: cannot modify core directory')`
- `edit` 的 `old` 必须在文件中**唯一匹配**，否则抛出 `Error(\`edit: old string must match exactly once, found ${count} times\`)`
- `bash` 执行完成后，**自动将命令和输出追加写入 `terminalLog`**（通过注入的实例）
- `bash` 的 `stderr` 合并到返回值，格式沿用 v1：`stdout + '\n[stderr]\n' + stderr`
- 参考 v1 的 `localPrimitives` 实现，签名不同但逻辑相同

---

### `src/core/llm.ts`

```typescript
export type JudgeType = 'outcome' | 'risk' | 'selection' | 'capability';
// v2 新增 'capability'，用于启动时的能力边界声明

export interface LLMProvider {
  complete(systemPrompt: string, userMessage: string): Promise<string>;
}

export class LLMCall {
  constructor(private provider: LLMProvider) {}
  async reason(context: string, input: string): Promise<LLMCallResult>
  async reasonMulti(context: string, input: string, n?: number): Promise<LLMCallMulti>
  async judge(type: JudgeType, context: string, input: string): Promise<LLMCallResult>
}
```

**实现要求：**
- `judge` 收到非法 type 时**立即抛出** `Error(\`judge: unknown type "\${type}"\`)`，不能静默失败
- `capability` type 的 prompt：`'判断任务是否在 agent 能力和权限范围内（完全可行/部分可行/不可行 + 理由）'`
- JSON 解析失败时 `uncertainty.score` 默认 **0.8**（与 v1 一致），`reasons` 为 `['JSON 解析失败']`
- `extractJson` 的正则沿用 v1：`/\{[\s\S]*\}$/`，但要处理模型输出带 markdown 代码块的情况（先剥离 ` ```json ` 和 ` ``` `）

---

### `src/core/trace.ts` ★ v2 核心变化：双流

```typescript
// Trace：推理书，记录"为什么"
export type TraceEntry = {
  ts: number;
  seq: number;           // 全局自增序号
  kind: 'collect' | 'reason' | 'judge' | 'exec' | 'observe' |
        'state' | 'escalate' | 'stop' | 'interrupt' | 'narrative';
  data: unknown;
  confidence?: Confidence;
  uncertainty?: Uncertainty;
  terminal_seq?: number; // 关联的 TerminalLog 序号（exec 类型时填写）
  tags?: string[];
};

// TerminalLog：执行终端，记录"做了什么"
export type TerminalEntry = {
  ts: number;
  seq: number;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  dry_run?: boolean;     // Dry-run 标记（预留，默认 false）
};
```

**实现要求：**
- `Trace` 和 `TerminalLog` 各自维护独立的自增 `seq`（从 1 开始）
- 两者都接受构造参数 `logFilePath?: string`，如果提供则**每次 `append` 后同步追加写入 `.jsonl` 文件**（每条记录一行 JSON）
- 文件不存在时自动创建，存在时追加（不覆盖），使用 `fs.appendFile`
- `Trace` 保留 v1 的 `filterByTag`、`all()`、`serialize()` 方法
- `TerminalLog` 同样提供 `all()` 和 `serialize()` 方法
- **写文件失败不抛错**，静默忽略（日志系统不能让主流程崩溃）

---

### `src/core/collect.ts`

与 v1 的 `collect.ts` 逻辑基本相同，以下是差异点：

- `CollectSource.type` 沿用 v1 的三种：`'file' | 'bash' | 'trace_tag'`
- `bash` 类型的 source 调用 `primitives.bash()`，会自动写入 TerminalLog（原语层已处理）
- `coverage` 计算：失败 source **计入分母但不计入分子**（与 v1 一致）
- `maxTokens` 截断：1 token ≈ 4 字符（与 v1 一致）
- 函数签名与 v1 完全相同，不需要修改

---

### `src/runtime/state.ts` ★ v2 新增：StateManager 持久化

```typescript
export type PermissionLevel = 0 | 1 | 2 | 3 | 4;
export type Mode = 'plan' | 'execute' | 'review' | 'recovery' | 'paused';

export type AgentState = {
  goal: string;
  subgoals: string[];
  currentSubgoal: string | null;
  archivedSubgoals: string[];    // v2 新增：已完成子目标，不再进入 active context
  mode: Mode;
  permissions: PermissionLevel;
  iterationCount: number;
  noProgressCount: number;
  version: number;
  custom: Record<string, unknown>;
};

export class StateManager {
  async load(agentDir: string): Promise<AgentState | null>
  async save(agentDir: string, state: AgentState): Promise<void>
  createInitial(goal: string, permissions?: PermissionLevel): AgentState
}
```

**实现要求：**
- `load`：读取 `{agentDir}/state.json`，不存在返回 `null`，JSON 解析失败返回 `null`（不抛错）
- `save`：**原子写入**——先写 `state.json.tmp`，再 rename 为 `state.json`，防止写入中途崩溃
- `createInitial`：默认 `mode: 'plan'`，`permissions: 2`，其他数组字段为空
- `canTransition(from, to)` 和 `MODE_TRANSITIONS` 切换表沿用 v1，**新增 `paused`**：
  ```typescript
  paused: ['plan', 'stop']  // stop 用字符串表示，由 Loop 处理
  // 任何 mode → paused 都合法（Interrupt 可以从任何状态触发）
  ```
- `createInitialState` 作为 `new StateManager().createInitial` 的别名导出（兼容 v1 的调用方式）

---

### `src/runtime/harness.ts`

与 v1 的 `Harness` 逻辑完全相同，以下是差异点：

- 构造函数接受第三个可选参数 `agentDir?: string`，用于确认 `.agent/` 目录不在 git 管理范围内
- `snapshot` 和 `rollback` 逻辑与 v1 **完全相同**，直接复用
- **不需要修改任何核心逻辑**

---

### `src/runtime/interrupt.ts` ★ v2 新增

```typescript
export type InterruptSignal = {
  message: string;
  ts: number;
};

export type UserDirective = {
  action: 'continue' | 'modify_goal' | 'stop';
  newGoal?: string;      // action === 'modify_goal' 时填写
  message?: string;      // 给 agent 的附加说明
};

export class InterruptChannel {
  push(signal: InterruptSignal): void
  poll(): InterruptSignal | null   // 非阻塞，队列为空返回 null
  isEmpty(): boolean
}
```

**实现要求：**
- 纯内存实现，使用数组队列，FIFO
- `poll()` 取出并移除队列头部，不阻塞
- 不需要持久化

---

### `src/runtime/loop.ts` ★ v2 核心变化：Hooks 解耦

```typescript
export type LoopHooks = {
  onBeforeExec?:     (state: AgentState, proposal: string) => Promise<'proceed' | 'block'>
  onAfterObserve?:   (state: AgentState, result: string)   => Promise<'continue' | 'recover' | 'escalate'>
  onModeTransition?: (from: Mode, to: Mode, state: AgentState) => Promise<void>
  shouldSnapshot?:   (state: AgentState) => Promise<boolean>
  classifyError?:    (error: unknown) => 'retryable' | 'logic' | 'environment' | 'budget'
  onInterrupt?:      (signal: InterruptSignal, state: AgentState) => Promise<UserDirective>
};

export type LoopDeps = {
  primitives: Primitives;
  llm: LLMCall;
  trace: Trace;
  terminalLog: TerminalLog;
  harness: Harness;
  interrupt: InterruptChannel;
  stateManager: StateManager;
  agentDir: string;   // .agent/ 目录路径，用于 State 持久化
};

export type LoopConfig = {
  collectConfig: CollectConfig;
  thresholds?: Partial<typeof DEFAULT_THRESHOLDS>;
  onEscalate?: (reason: string, state: AgentState) => Promise<void>;
  onStop?: (state: AgentState) => Promise<void>;
};

export type LoopResult =
  | { status: 'completed';       state: AgentState }
  | { status: 'escalated';       reason: string; state: AgentState }
  | { status: 'budget_exceeded'; state: AgentState };

export async function runLoop(
  state: AgentState,
  config: LoopConfig,
  deps: LoopDeps,
  hooks?: LoopHooks,
): Promise<LoopResult>
```

**Loop 必须严格按以下顺序执行（不可调整）：**

```
每次迭代开始：
  1. [Interrupt 检查] poll() → 有信号时进入 Paused 处理
  2. [终止条件] 三个检查（目标完成 / 无增益超限 / 迭代超限）★ 一等概念
  3. [Collect] → confidence 分支：补采集 / Escalate / 继续
  4. [Plan 模式] LLMCall[Reason] → uncertainty 分支：多候选 / Escalate
               → Judge(risk) → 不通过时 Escalate
               → 切换到 Execute（经 canTransition 校验）
  5. [Execute 模式] → shouldSnapshot Hook → 快照失败阻断
                   → onBeforeExec Hook → block 时 Escalate
                   → 执行（写 Trace exec 条目）
                   → 切换到 Review
  6. [Review 模式] → Judge(outcome) → 未达成时递增 noProgressCount
                  → 达成时归档子目标，切换到 Plan 或完成
  7. [Recovery 模式] → harness.rollback() → 切换到 Plan
  8. [Paused 模式] → onInterrupt Hook → 应用 UserDirective
  9. 每次迭代结束：stateManager.save(agentDir, state)
```

**关键实现细节：**

- 默认阈值与 v1 完全相同：`confidenceLow: 0.3, confidenceMid: 0.6, uncertaintyHigh: 0.7, maxCollectRetry: 3, maxNoProgress: 3, maxIterations: 50`
- `shouldSnapshot` Hook 为空时**默认不快照**（与 v1 的自动快照不同，v2 快照由策略决定）
- `onBeforeExec` Hook 为空时**默认 proceed**
- `onAfterObserve` Hook 为空时**默认 continue**
- `classifyError` Hook 为空时**默认所有错误为 'logic'**（进 Recovery）
- Mode 切换统一通过 `canTransition` 校验，校验失败写 Trace 警告但不 crash
- Paused 模式下 `onInterrupt` Hook 为空时，默认打印信号并继续（`action: 'continue'`）
- **每次迭代结束调用 `stateManager.save()`**，确保 Session 可恢复

---

### `src/hooks/mode-state-machine.ts`

```typescript
export function createModeHooks(): Pick<LoopHooks, 'onModeTransition' | 'onAfterObserve'>
```

**实现要求：**
- `onModeTransition`：校验切换合法性，非法切换写 Trace 警告（不阻断，Loop 骨架的 `canTransition` 已阻断）
- `onAfterObserve`：根据结果字符串判断，含 `'recover'` 或 `'失败'` 时返回 `'recover'`，否则 `'continue'`

---

### `src/hooks/permission-guard.ts`

```typescript
export function createPermissionHooks(): Pick<LoopHooks, 'onBeforeExec'>
```

**实现要求（字符串匹配规则）：**

| 操作特征 | 需要的最低权限 |
|---------|-------------|
| `rm -rf` / `delete` / `DROP` / `truncate` | Level 3 |
| `curl` / `wget` / `fetch` / `http` / `https` | Level 3 |
| `write(` / `edit(` / `fs.write` | Level 1 |
| `bash(` / `exec(` / `spawn(` | Level 2 |
| 其他 | Level 0 |

- 当前权限不足时返回 `'block'`，并在返回前 console.warn 原因
- 权限满足时返回 `'proceed'`

---

### `src/hooks/error-classifier.ts`

```typescript
export function createErrorClassifier(): Pick<LoopHooks, 'classifyError'>
```

**分类规则（按优先级，从上到下匹配）：**

| 错误信息包含 | 分类 |
|------------|------|
| `ETIMEDOUT` / `ECONNRESET` / `ECONNREFUSED` / `lock` / `busy` / `temporarily` | `'retryable'` |
| `budget` / `token limit` / `rate limit` / `quota` | `'budget'` |
| `ENOENT` / `EACCES` / `EPERM` / `permission denied` / `not found` / `no such file` | `'environment'` |
| 其他 | `'logic'` |

---

### `src/index.ts`

```typescript
// 导出所有模块（兼容 v1 的导出方式，额外导出 v2 新增内容）

// 兼容 v1
export { type Primitives } from './core/primitives';
export { LLMCall, type LLMProvider, type JudgeType } from './core/llm';
export { collect, type CollectConfig, type CollectSource, type CollectResult } from './core/collect';
export { Trace, TerminalLog, type TraceEntry, type TerminalEntry, type Confidence, type Uncertainty } from './core/trace';
export { Harness } from './runtime/harness';
export { runLoop, type LoopConfig, type LoopResult, type LoopHooks, type LoopDeps } from './runtime/loop';
export { canTransition, createInitialState, type AgentState, type PermissionLevel, type Mode } from './runtime/state';

// v2 新增
export { StateManager } from './runtime/state';
export { InterruptChannel, type InterruptSignal, type UserDirective } from './runtime/interrupt';
export { createModeHooks } from './hooks/mode-state-machine';
export { createPermissionHooks } from './hooks/permission-guard';
export { createErrorClassifier } from './hooks/error-classifier';

// createMetaAgent：高层工厂函数
export async function createMetaAgent(
  projectPath: string,
  goal: string,
  llmProvider: LLMProvider,
  options?: {
    permissions?: PermissionLevel;
    subgoals?: string[];
    logToFile?: boolean;       // 是否将 Trace/TerminalLog 持久化到 .agent/ 目录
    hooks?: LoopHooks;         // 自定义 Hook（覆盖标准 Hook）
    collectConfig?: CollectConfig;
  }
): Promise<{
  run(loopConfig?: Partial<LoopConfig>): Promise<LoopResult>;
  interrupt(message: string): void;
  getState(): AgentState;
  getTrace(): Trace;
  getTerminalLog(): TerminalLog;
}>
```

**`createMetaAgent` 实现要求：**
1. 创建 `{projectPath}/.agent/` 目录（如不存在）
2. 初始化 `TerminalLog` 和 `Trace`（`logToFile` 为 true 时传入 `.agent/` 下的文件路径）
3. 用 `localPrimitives(coreDir, terminalLog)` 创建原语（`coreDir` 为当前 SDK 的 `src/` 目录绝对路径）
4. 用 `StateManager` 尝试恢复 State，失败则 `createInitial`
5. 组合标准 hooks：`createModeHooks()` + `createPermissionHooks()` + `createErrorClassifier()`，与 `options.hooks` 合并（options 优先）
6. 返回对象：`run()` 调用 `runLoop`；`interrupt()` 向 `InterruptChannel.push()`

---

## 第五步：测试要求

### `tests/core/trace.test.ts`
- `append()` 后 `all()` 长度正确，`seq` 自增
- `filterByTag()` 只返回含该 tag 的条目
- `serialize()` 输出合法 JSON
- `TerminalLog.append()` 写入后 `all()` 可读回
- Trace 和 TerminalLog 的 `seq` 各自独立自增
- 提供 `logFilePath` 时追加写文件（测试后清理临时文件）

### `tests/core/primitives.test.ts`
- `read()` 读取临时文件内容正确
- `write()` 写入后 `read()` 可读回
- `edit()` 唯一匹配时替换成功
- `edit()` 多处匹配时抛出含 `"found 2 times"` 的错误
- `bash()` 执行 `echo hello` 返回含 `hello` 的字符串
- `write()` 写入 coreDir 下的路径时抛出错误
- `bash()` 执行后 `TerminalLog` 新增一条记录

### `tests/core/llm.test.ts`
- `reason()` 返回含 `result` 和 `uncertainty` 字段
- `reasonMulti()` 返回 `candidates` 数组，长度 ≥ 2
- `judge('outcome', ...)` 不抛出异常
- `judge('capability', ...)` 不抛出异常（v2 新增）
- 传入非法 type 时抛出错误
- JSON 解析失败时 `uncertainty.score` 为 0.8

### `tests/core/collect.test.ts`
- `coverage` = 成功来源数 / 总来源数（参考 v1 测试）
- 来源失败时进入 `gaps`，`by_source` 中该 key 为 0
- `maxTokens` 生效时 context 长度不超过 `maxTokens * 4` 字符

### `tests/runtime/state.test.ts`
- `createInitial()` 默认 mode 为 `'plan'`，`archivedSubgoals` 为空数组
- `canTransition('plan', 'execute')` 返回 `true`
- `canTransition('plan', 'review')` 返回 `false`
- 任意 mode → `'paused'` 返回 `true`（v2 新增）
- `StateManager.save()` 后 `load()` 可恢复相同 State
- `StateManager.load()` 文件不存在时返回 `null`

### `tests/runtime/harness.test.ts`
- 与 v1 测试完全相同（逻辑未变）
- 在真实 git 仓库中 `snapshot()` 返回 `true`
- 非 git 目录 `snapshot()` 返回 `false`
- `rollback()` 无历史时返回 `false`

### `tests/runtime/interrupt.test.ts`
- `poll()` 空队列返回 `null`
- `push()` 后 `poll()` 返回信号，再次 `poll()` 返回 `null`
- 多次 `push()` 后按 FIFO 顺序 `poll()`

### `tests/runtime/loop.test.ts`（使用 mock LLMProvider）
- `maxIterations` 超出时返回 `{ status: 'budget_exceeded' }`
- `shouldSnapshot` 返回 `true` 但 harness.snapshot 失败时返回 `{ status: 'escalated' }`（含 `'快照'`）
- `onBeforeExec` 返回 `'block'` 时返回 `{ status: 'escalated' }`
- confidence 低于 `confidenceLow` 阈值时 Escalate
- `noProgressCount` 超出 `maxNoProgress` 时 Escalate
- 所有子目标完成时返回 `{ status: 'completed' }`
- 每次迭代后 State 被持久化（`stateManager.save` 被调用）
- Interrupt 信号触发后 mode 切换为 `'paused'`

### `tests/hooks/*.test.ts`
- Mode 状态机：非法切换触发警告，不 crash
- 权限检查：proposal 含 `'curl'` 时 Level 2 返回 `'block'`，Level 3 返回 `'proceed'`
- 错误分类：`ETIMEDOUT` → `'retryable'`，`ENOENT` → `'environment'`，其他 → `'logic'`

### `tests/integration.test.ts`（完整流程，使用 mock）
- 从 `plan` 模式启动，经 `execute → review`，最终 `completed`
- Trace 中包含 `collect`、`reason`、`judge`、`exec`、`stop` 类型条目
- TerminalLog 中有 bash 命令记录（如果 execute 阶段调用了 bash）
- State.version 在每次 mode 切换后递增
- `createMetaAgent` 工厂函数可正常创建并 `run()`

---

## 第六步：端到端示例

```typescript
// example/run.ts
// 任务：用 agent 自动分析一段有 bug 的代码，定位问题并输出修复建议

import fs from 'fs/promises';
import path from 'path';

// ── LLM 接入（与 v1 完全相同的接入方式）──────────────────────
const BASE_URL = 'http://35.220.164.252:3888/v1';
const MODEL    = 'MiniMax-M2.5';
const API_KEY  = 'My API Key';

import { createMetaAgent } from '../src/index';

async function setupWorkspace(dir: string) {
  await fs.mkdir(dir, { recursive: true });

  const { exec } = require('child_process');
  const run = (cmd: string, cwd = dir) => new Promise<void>((res, rej) =>
    exec(cmd, { cwd }, (err: any) => err ? rej(err) : res()));

  await run('git init');
  await run('git config user.email "agent@test.com"');
  await run('git config user.name "Agent"');

  await fs.writeFile(path.join(dir, 'AGENTS.md'), `
# 项目上下文
这是一个 TypeScript 工具库，包含数组处理函数。
目标：发现并修复代码中的 bug。
约定：修复建议写入 FIXME.md。
`.trim());

  await fs.writeFile(path.join(dir, 'utils.ts'), `
export function average(nums: number[]): number {
  let sum = 0;
  for (let i = 0; i <= nums.length; i++) {  // BUG 1: <= 应为 <
    sum += nums[i];
  }
  return sum / nums.length;
}

export function findMax(nums: number[]): number {
  let max = 0;  // BUG 2: 应初始化为 -Infinity 或 nums[0]
  for (const n of nums) {
    if (n > max) max = n;
  }
  return max;
}
`.trim());

  await run('git add -A');
  await run('git commit -m "initial"');
}

async function main() {
  const workDir = path.join('/tmp', 'meta-agent-v2-' + Date.now());
  await setupWorkspace(workDir);

  console.log('═'.repeat(60));
  console.log('  Meta Agent Runtime Core SDK v2 — 端到端示例');
  console.log('  工作目录:', workDir);
  console.log('═'.repeat(60));

  // 使用 node 原生 fetch（Node 18+）或 node-fetch
  const realProvider = {
    async complete(system: string, user: string): Promise<string> {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: 'system', content: system },
            { role: 'user',   content: user },
          ],
          temperature: 0.3,
          max_tokens: 1024,
        }),
      });
      if (!res.ok) throw new Error(`LLM API error: ${res.status} ${await res.text()}`);
      const data = await res.json() as any;
      return data.choices[0].message.content;
    },
  };

  const agent = await createMetaAgent(
    workDir,
    '分析 utils.ts 中的 bug，并将修复建议写入 FIXME.md',
    realProvider,
    {
      permissions: 2,
      subgoals: ['读取代码并定位 bug', '生成修复建议并写入 FIXME.md'],
      logToFile: true,
    }
  );

  // 模拟用户 5 秒后打断（测试 Interrupt 机制）
  setTimeout(() => {
    console.log('\n[用户打断] 发送 Interrupt 信号...');
    agent.interrupt('请继续，不需要修改目标');
  }, 5000);

  const result = await agent.run({
    collectConfig: {
      sources: [
        { type: 'file', query: path.join(workDir, 'AGENTS.md') },
        { type: 'file', query: path.join(workDir, 'utils.ts') },
      ],
      maxTokens: 2000,
    },
    thresholds: {
      confidenceLow:   0.2,
      confidenceMid:   0.5,
      uncertaintyHigh: 0.75,
      maxIterations:   20,
      maxNoProgress:   3,
    },
    onEscalate: async (reason, s) => {
      console.log('\n⚠️  [ESCALATE]', reason, '| mode:', s.mode);
    },
    onStop: async (s) => {
      console.log('\n✅ [STOP] 任务完成 | 迭代:', s.iterationCount);
    },
  });

  // 输出结果
  console.log('\n' + '─'.repeat(60));
  console.log('运行结果:    ', result.status);
  console.log('State 版本:  ', result.state.version);

  const trace = agent.getTrace();
  const terminalLog = agent.getTerminalLog();
  console.log('Trace 条数:  ', trace.all().length);
  console.log('Terminal 条数:', terminalLog.all().length);

  console.log('\nTrace 摘要:');
  for (const e of trace.all()) {
    const unc = e.uncertainty ? ` unc=${e.uncertainty.score.toFixed(2)}` : '';
    const cov = e.confidence  ? ` cov=${e.confidence.coverage.toFixed(2)}` : '';
    const tseq = e.terminal_seq ? ` →terminal#${e.terminal_seq}` : '';
    console.log(`  [${String(e.seq).padStart(3)}] ${e.kind}${unc}${cov}${tseq}`);
  }

  if (terminalLog.all().length > 0) {
    console.log('\nTerminal 摘要:');
    for (const e of terminalLog.all()) {
      console.log(`  [${String(e.seq).padStart(3)}] $ ${e.command.slice(0, 60)} (${e.durationMs}ms, exit=${e.exitCode})`);
    }
  }

  try {
    const fixme = await fs.readFile(path.join(workDir, 'FIXME.md'), 'utf-8');
    console.log('\nFIXME.md 内容:\n' + '─'.repeat(40));
    console.log(fixme);
  } catch {
    console.log('\n（agent 未写入 FIXME.md）');
  }

  // .agent/ 目录内容
  console.log('\n.agent/ 目录:');
  try {
    const files = await fs.readdir(path.join(workDir, '.agent'));
    for (const f of files) console.log(' ', f);
  } catch {}
}

main().catch(console.error);
```

---

## 第七步：执行验证顺序

```bash
# 1. TypeScript 编译（零错误）
npm run build

# 2. 全量测试
npm test

# 3. 覆盖率（目标 > 80%）
npm run test:coverage

# 4. 端到端示例
npm run example
```

---

## 验收标准

| 验收项 | 标准 |
|--------|------|
| TypeScript 编译 | 零错误，严格模式通过 |
| 单元测试 | 全部通过，覆盖率 = 100% |
| 原语接口 | 签名与设计原则 100% 一致，不可修改 |
| Judge type | 所有调用均显式传入 type，传非法 type 抛错 |
| Harness 阻断 | `shouldSnapshot` 返回 true 且 snapshot 失败时必定 escalated |
| 双流日志 | Trace 和 TerminalLog 独立自增 seq，bash 执行自动写 TerminalLog |
| Session 恢复 | `StateManager.save/load` 可跨 Session 恢复 State |
| Interrupt | push 信号后下一次迭代边界触发 Paused 模式 |
| Hooks 解耦 | Loop 骨架不感知具体策略，所有策略通过 Hook 注入 |
| 端到端示例 | 成功连接 LLM，Trace ≥ 5 条，TerminalLog ≥ 1 条，进程正常退出 |

---

## 常见陷阱（v1 经验 + v2 新增）

**继承自 v1 的陷阱：**
- `edit()` 必须验证 old 唯一匹配，`content.split(old).length - 1` 是正确的计数方式
- `collect.ts` 中 coverage 计算：失败 source 计入分母但不计入分子
- LLM 判断 `riskApproved` 需同时检查中英文：`"通过" || "pass" || "approved" || "yes"`
- `harness.ts` git commit 使用 `--allow-empty` 避免无改动时失败
- `extractJson` 正则 `/\{[\s\S]*\}$/` 匹配最后一个 JSON 块

**v2 新增陷阱：**
- `bash` 原语执行后**必须写 TerminalLog**，不要忘记注入 terminalLog 实例
- `StateManager.save()` 必须用原子写（tmp → rename），直接写会有损坏风险
- Loop 中 `shouldSnapshot` Hook 为空时**不快照**（v2 行为），与 v1 的自动快照不同
- `TerminalLog` 的 `seq` 和 `Trace` 的 `seq` 是各自独立的，不要共享同一个计数器
- `Trace` 的 `exec` 条目写入时记得填 `terminal_seq`（关联刚写入 TerminalLog 的 seq）
- `canTransition` 切换表中，任意 mode → `'paused'` 都应该返回 true
- `createMetaAgent` 中组合 hooks 时，`options.hooks` 的优先级高于标准 hooks

---

## 完成后输出

```
✅ v2 实现完成报告
- 文件数量：X 个
- 测试通过：X / X
- 覆盖率：X%
- 端到端示例：成功 / 失败（附原因）
- Trace 条数：X
- TerminalLog 条数：X
- LLM 调用次数：X
- v1 → v2 主要变化：[简要列出]
```
