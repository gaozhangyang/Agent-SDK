# Agent Runtime Core SDK

> 基于《Coding Agent 设计原则分级指南》L0 + L1 的最简约实现方案
> 面向 opencode prompt / 系统集成，作为可复用 SDK 供上层应用调用


---

## 一、设计哲学

本 SDK 严格实现 **L0（所有 Agent 必须具备）+ L1（大多数场景需要）**，不引入任何 L2/L3 能力。每一个实现决策均对应原则文档中的具体条款。

**三条核心约束：**

1. 原语接口冻结，上层可演化，原语不可改变签名
2. `Collect` 是编排协议，不是原语，复杂性留在此处，不外溢
3. 终止条件是一等概念，必须显式定义

---

## 二、SDK 结构总览

```
agent-runtime-core/
├── primitives.ts          # L0.1 四个执行原语（接口定义）
├── llm.ts                 # L0.2 LLMCall（Reason / Judge）
├── collect.ts             # L0.3 Collect 编排协议
├── loop.ts                # L0.4 核心执行循环
├── harness.ts             # L0.6 版本快照 Harness
├── state.ts               # L1.1 + L1.2 State 结构体（权限 + Mode）
├── trace.ts               # Trace 追加写入，含质量信号
└── index.ts               # SDK 对外入口
```

---

## 三、Trace（系统调试基础）

所有 `confidence` 和 `uncertainty` 统一写入 Trace。这是整个系统可调试性的基础，先于其他模块定义。

```typescript
// trace.ts

export type TraceEntry = {
  ts: number;                  // Unix ms
  kind: 'collect' | 'reason' | 'judge' | 'exec' | 'observe' | 'state' | 'escalate' | 'stop';
  data: unknown;               // 任意结构化数据
  confidence?: Confidence;     // Collect 产出，写入此字段
  uncertainty?: Uncertainty;   // LLMCall 产出，写入此字段
  tags?: string[];             // L1.4 标签约定（可选）
};

export type Confidence = {
  coverage: number;            // 0-1，信息充分性
  reliability: number;         // 0-1，信息可信度
  gaps: string[];              // 缺少哪些信息
  by_source: Record<string, number>; // 每个来源的可信度
};

export type Uncertainty = {
  score: number;               // 0-1，输出可靠性的反面
  reasons: string[];           // 具体不确定原因
};

export class Trace {
  private entries: TraceEntry[] = [];

  append(entry: TraceEntry): void {
    this.entries.push(entry);
  }

  // L1.4：标签过滤检索（bash grep 的 TS 等价）
  filterByTag(tag: string): TraceEntry[] {
    return this.entries.filter(e => e.tags?.includes(tag));
  }

  all(): TraceEntry[] {
    return [...this.entries];
  }

  // 序列化供持久化或调试
  serialize(): string {
    return JSON.stringify(this.entries, null, 2);
  }
}
```

---

## 四、L0.1 — 四个执行原语

接口定义冻结，永不修改。实现层可以替换（本地 fs、sandbox、远程等），但签名不变。

```typescript
// primitives.ts

export interface Primitives {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  edit(path: string, old: string, next: string): Promise<void>;  // old 须唯一匹配
  bash(command: string): Promise<string>;
}

// 默认实现：本地文件系统 + 子进程
import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const localPrimitives: Primitives = {
  async read(path) {
    return fs.readFile(path, 'utf-8');
  },

  async write(path, content) {
    await fs.writeFile(path, content, 'utf-8');
  },

  async edit(path, old, next) {
    const content = await fs.readFile(path, 'utf-8');
    const count = content.split(old).length - 1;
    if (count !== 1) {
      throw new Error(`edit: old string must match exactly once, found ${count} times`);
    }
    await fs.writeFile(path, content.replace(old, next), 'utf-8');
  },

  async bash(command) {
    const { stdout, stderr } = await execAsync(command);
    return stdout + (stderr ? `\n[stderr]\n${stderr}` : '');
  },
};
```

---

## 五、L0.2 — LLMCall（推理引擎）

两种模式：`Reason`（发散生成）和 `Judge`（收敛裁决）。Judge 必须显式指定 `type`。

```typescript
// llm.ts

import type { Uncertainty } from './trace';

export type JudgeType = 'outcome' | 'risk' | 'selection';

export type LLMCallResult = {
  result: string;
  uncertainty: Uncertainty;
};

export type LLMCallMulti = {
  candidates: string[];
  uncertainty: Uncertainty;
};

export interface LLMProvider {
  complete(systemPrompt: string, userMessage: string): Promise<string>;
}

export class LLMCall {
  constructor(
    private provider: LLMProvider,
    // L1.5：可替换提供商，此处注入
  ) {}

  // Reason：发散生成提案
  async reason(context: string, input: string): Promise<LLMCallResult> {
    const system = `你是一个编码 Agent。请根据 context 完成任务，并在末尾以 JSON 输出：
{"uncertainty": {"score": 0-1, "reasons": []}}`;
    const raw = await this.provider.complete(system, `Context:\n${context}\n\nTask:\n${input}`);
    return this.parseWithUncertainty(raw);
  }

  // Reason（多候选）：uncertainty 高时使用
  async reasonMulti(context: string, input: string, n = 3): Promise<LLMCallMulti> {
    const system = `你是一个编码 Agent。请生成 ${n} 个候选方案，每个方案独立可用。
以 JSON 输出：{"candidates": ["方案1", "方案2", ...], "uncertainty": {"score": 0-1, "reasons": []}}`;
    const raw = await this.provider.complete(system, `Context:\n${context}\n\nTask:\n${input}`);
    const parsed = JSON.parse(this.extractJson(raw));
    return {
      candidates: parsed.candidates,
      uncertainty: parsed.uncertainty,
    };
  }

  // Judge：收敛裁决，必须显式指定 type
  async judge(type: JudgeType, context: string, input: string): Promise<LLMCallResult> {
    const typeDescriptions: Record<JudgeType, string> = {
      outcome: '判断子目标是否达成（是/否 + 理由）',
      risk:    '判断操作是否允许执行，权限是否满足（通过/拒绝 + 理由）',
      selection: '从多个候选方案中选出最优（选项编号 + 理由）',
    };
    const system = `你是一个裁决 Agent。任务类型：${typeDescriptions[type]}。
请给出明确结论，并在末尾以 JSON 输出：
{"decision": "...", "uncertainty": {"score": 0-1, "reasons": []}}`;
    const raw = await this.provider.complete(system, `Context:\n${context}\n\nInput:\n${input}`);
    return this.parseWithUncertainty(raw);
  }

  private parseWithUncertainty(raw: string): LLMCallResult {
    const jsonStr = this.extractJson(raw);
    try {
      const parsed = JSON.parse(jsonStr);
      return {
        result: parsed.decision ?? parsed.result ?? raw,
        uncertainty: parsed.uncertainty ?? { score: 0.5, reasons: ['未能解析 uncertainty'] },
      };
    } catch {
      return {
        result: raw,
        uncertainty: { score: 0.8, reasons: ['JSON 解析失败'] },
      };
    }
  }

  private extractJson(text: string): string {
    const match = text.match(/\{[\s\S]*\}$/);
    return match ? match[0] : '{}';
  }
}
```

---

## 六、L0.3 — Collect 编排协议

`Collect` 是**编排协议**，不是原语。所有检索、过滤、截断的策略复杂性收敛于此。

```typescript
// collect.ts

import type { Primitives } from './primitives';
import type { Confidence } from './trace';

export type CollectSource = {
  type: 'file' | 'bash' | 'trace_tag';
  query: string;             // 文件路径 / bash 命令 / trace 标签
  weight?: number;           // 可信度权重，默认 1.0
};

export type CollectResult = {
  context: string;
  confidence: Confidence;
};

export type CollectConfig = {
  sources: CollectSource[];
  filters?: string[];        // 关键词过滤（可选）
  maxTokens?: number;        // L1.6 上下文预算
};

export async function collect(
  config: CollectConfig,
  primitives: Primitives,
  traceFilterFn?: (tag: string) => Array<{ data: unknown }>,
): Promise<CollectResult> {
  const parts: string[] = [];
  const bySource: Record<string, number> = {};
  const gaps: string[] = [];

  for (const source of config.sources) {
    try {
      let content = '';
      if (source.type === 'file') {
        content = await primitives.read(source.query);
      } else if (source.type === 'bash') {
        // L1.3 精确代码搜索：ripgrep / grep 优先于向量索引
        content = await primitives.bash(source.query);
      } else if (source.type === 'trace_tag' && traceFilterFn) {
        const entries = traceFilterFn(source.query);
        content = entries.map(e => JSON.stringify(e.data)).join('\n');
      }

      if (config.filters?.length) {
        const matched = config.filters.some(f => content.includes(f));
        if (!matched) { gaps.push(source.query); continue; }
      }

      parts.push(`[来源: ${source.query}]\n${content}`);
      bySource[source.query] = source.weight ?? 1.0;
    } catch (err) {
      gaps.push(source.query);
      bySource[source.query] = 0;
    }
  }

  let context = parts.join('\n\n---\n\n');

  // L1.6：上下文预算截断（粗略按字符估算）
  if (config.maxTokens && context.length > config.maxTokens * 4) {
    context = context.slice(0, config.maxTokens * 4) + '\n\n[... 已截断，超出 token 预算]';
  }

  const filledRatio = parts.length / Math.max(config.sources.length, 1);
  const avgReliability = Object.values(bySource).length > 0
    ? Object.values(bySource).reduce((a, b) => a + b, 0) / Object.values(bySource).length
    : 0;

  return {
    context,
    confidence: {
      coverage: filledRatio,
      reliability: avgReliability,
      gaps,
      by_source: bySource,
    },
  };
}
```

---

## 七、L0.4 + L1.1 + L1.2 — 核心执行循环

包含权限状态机（L1.1）和 Role/Mode 状态机（L1.2），终止条件是一等概念。

### 7.1 State 结构体

```typescript
// state.ts

export type PermissionLevel = 0 | 1 | 2 | 3 | 4;

// L1.1 权限级别说明：
// 0 = 只读（read）
// 1 = 受控写（write/edit，限工作区）
// 2 = 受控执行（bash 常规，无网络/删除）
// 3 = 高风险执行（bash 网络、删除、系统级变更）
// 4 = 自主模式（预授权范围内自动执行）

export type Mode = 'plan' | 'execute' | 'review' | 'recovery';

// L1.2 Mode 说明：
// plan     = 只读 + LLMCall[Reason]，不触发有副作用工具
// execute  = 完整工具访问，执行已批准动作
// review   = 只读 + LLMCall[Judge(outcome)]，检查不生成
// recovery = 只允许 bash(git) 和 read，专注诊断与回退

export type AgentState = {
  goal: string;
  subgoals: string[];
  currentSubgoal: string | null;
  mode: Mode;
  permissions: PermissionLevel;
  iterationCount: number;
  noProgressCount: number;        // 连续无增益计数
  version: number;                // State 版本号，每次更新递增
  custom: Record<string, unknown>; // 应用层扩展字段
};

export function createInitialState(goal: string, permissions: PermissionLevel = 2): AgentState {
  return {
    goal,
    subgoals: [],
    currentSubgoal: null,
    mode: 'plan',
    permissions,
    iterationCount: 0,
    noProgressCount: 0,
    version: 0,
    custom: {},
  };
}

// Mode 合法切换表（L1.2 切换规则）
export const MODE_TRANSITIONS: Record<Mode, Mode[]> = {
  plan:     ['execute', 'recovery'],
  execute:  ['review', 'recovery', 'plan'],
  review:   ['execute', 'plan', 'recovery'],
  recovery: ['plan'],
};

export function canTransition(from: Mode, to: Mode): boolean {
  return MODE_TRANSITIONS[from].includes(to);
}
```

### 7.2 核心循环

```typescript
// loop.ts

import { collect, type CollectConfig } from './collect';
import { LLMCall } from './llm';
import { Trace } from './trace';
import { Harness } from './harness';
import { canTransition, type AgentState } from './state';
import type { Primitives } from './primitives';

// 阈值常量（可由调用方覆盖）
const DEFAULT_THRESHOLDS = {
  confidenceLow: 0.3,       // 低于此值直接 Escalate
  confidenceMid: 0.6,       // 低于此值触发补采集
  uncertaintyHigh: 0.7,     // 高于此值触发多候选或 Escalate
  maxCollectRetry: 3,        // 最大补采集重试次数
  maxNoProgress: 3,          // 连续无增益上限
  maxIterations: 50,         // 最大迭代次数（token/时间预算）
};

export type LoopConfig = {
  collectConfig: CollectConfig;
  thresholds?: Partial<typeof DEFAULT_THRESHOLDS>;
  onEscalate?: (reason: string, state: AgentState) => Promise<void>;
  onStop?: (state: AgentState) => Promise<void>;
};

export type LoopResult =
  | { status: 'completed'; state: AgentState }
  | { status: 'escalated'; reason: string; state: AgentState }
  | { status: 'budget_exceeded'; state: AgentState };

export async function runLoop(
  state: AgentState,
  config: LoopConfig,
  primitives: Primitives,
  llm: LLMCall,
  trace: Trace,
  harness: Harness,
): Promise<LoopResult> {
  const t = { ...DEFAULT_THRESHOLDS, ...config.thresholds };

  while (true) {
    state.iterationCount++;

    // ── 终止条件检查（一等概念）──────────────────────────────
    if (state.iterationCount > t.maxIterations) {
      trace.append({ ts: Date.now(), kind: 'stop', data: { reason: 'budget_exceeded' } });
      await config.onStop?.(state);
      return { status: 'budget_exceeded', state };
    }

    if (state.noProgressCount >= t.maxNoProgress) {
      const reason = '连续无增益，超出上限';
      trace.append({ ts: Date.now(), kind: 'escalate', data: { reason } });
      await config.onEscalate?.(reason, state);
      return { status: 'escalated', reason, state };
    }

    if (!state.currentSubgoal && state.subgoals.length === 0) {
      // 目标已完成
      trace.append({ ts: Date.now(), kind: 'stop', data: { reason: 'goal_completed' } });
      await config.onStop?.(state);
      return { status: 'completed', state };
    }

    // ── Step 1: Collect ────────────────────────────────────
    let collectResult = await collect(
      config.collectConfig,
      primitives,
      (tag) => trace.filterByTag(tag),
    );
    trace.append({
      ts: Date.now(), kind: 'collect',
      data: { sources: config.collectConfig.sources.map(s => s.query) },
      confidence: collectResult.confidence,
    });

    // 补采集循环（coverage 低，reliability 高）
    let collectRetry = 0;
    while (
      collectResult.confidence.coverage < t.confidenceMid &&
      collectResult.confidence.reliability >= t.confidenceMid &&
      collectRetry < t.maxCollectRetry
    ) {
      collectRetry++;
      collectResult = await collect(config.collectConfig, primitives, (tag) => trace.filterByTag(tag));
      trace.append({
        ts: Date.now(), kind: 'collect',
        data: { retry: collectRetry },
        confidence: collectResult.confidence,
      });
    }

    // 置信度太低 → Escalate
    if (
      collectResult.confidence.coverage < t.confidenceLow ||
      collectResult.confidence.reliability < t.confidenceLow
    ) {
      const reason = `置信度不足: coverage=${collectResult.confidence.coverage.toFixed(2)}, reliability=${collectResult.confidence.reliability.toFixed(2)}`;
      trace.append({ ts: Date.now(), kind: 'escalate', data: { reason }, confidence: collectResult.confidence });
      await config.onEscalate?.(reason, state);
      return { status: 'escalated', reason, state };
    }

    // ── Step 2: Plan 模式下执行 Reason ──────────────────────
    if (state.mode === 'plan') {
      const taskDesc = state.currentSubgoal ?? state.goal;
      const reasonResult = await llm.reason(collectResult.context, taskDesc);
      trace.append({
        ts: Date.now(), kind: 'reason',
        data: { task: taskDesc, result: reasonResult.result },
        uncertainty: reasonResult.uncertainty,
      });

      if (reasonResult.uncertainty.score > t.uncertaintyHigh) {
        // 不确定性高 → 多候选
        const multi = await llm.reasonMulti(collectResult.context, taskDesc);
        trace.append({
          ts: Date.now(), kind: 'reason',
          data: { multi: true, candidates: multi.candidates },
          uncertainty: multi.uncertainty,
        });

        if (multi.uncertainty.score > t.uncertaintyHigh) {
          const reason = `Reason 不确定性过高: ${multi.uncertainty.score.toFixed(2)}`;
          trace.append({ ts: Date.now(), kind: 'escalate', data: { reason } });
          await config.onEscalate?.(reason, state);
          return { status: 'escalated', reason, state };
        }

        // 多候选 → Judge(selection) 仲裁
        const selResult = await llm.judge('selection', collectResult.context, JSON.stringify(multi.candidates));
        trace.append({ ts: Date.now(), kind: 'judge', data: { type: 'selection', decision: selResult.result }, uncertainty: selResult.uncertainty });
        state.custom['pendingProposal'] = selResult.result;
      } else {
        state.custom['pendingProposal'] = reasonResult.result;
      }

      // Plan → Execute（需 Judge(risk) 通过）
      const riskResult = await llm.judge('risk', collectResult.context, String(state.custom['pendingProposal']));
      trace.append({ ts: Date.now(), kind: 'judge', data: { type: 'risk', decision: riskResult.result }, uncertainty: riskResult.uncertainty });

      const riskApproved = riskResult.result.toLowerCase().includes('通过') || riskResult.result.toLowerCase().includes('pass');
      if (!riskApproved || riskResult.uncertainty.score > t.uncertaintyHigh) {
        const reason = `Judge(risk) 拒绝或不确定性过高: ${riskResult.result}`;
        trace.append({ ts: Date.now(), kind: 'escalate', data: { reason } });
        await config.onEscalate?.(reason, state);
        return { status: 'escalated', reason, state };
      }

      // 切换到 Execute
      if (canTransition(state.mode, 'execute')) {
        state.mode = 'execute';
        state.version++;
        trace.append({ ts: Date.now(), kind: 'state', data: { modeTransition: 'plan→execute' } });
      }
      continue;
    }

    // ── Step 4: Execute 模式 ────────────────────────────────
    if (state.mode === 'execute') {
      const proposal = String(state.custom['pendingProposal'] ?? '');

      // Harness 自动快照（只对有副作用操作）
      const snapshotOk = await harness.snapshot(`iter-${state.iterationCount}`);
      if (!snapshotOk) {
        // 快照失败默认阻断（L0.6）
        trace.append({ ts: Date.now(), kind: 'escalate', data: { reason: '快照失败，阻断执行' } });
        await config.onEscalate?.('快照失败', state);
        return { status: 'escalated', reason: '快照失败', state };
      }

      // 执行动作（实际工具调用由上层应用补充，此处为占位接口）
      trace.append({ ts: Date.now(), kind: 'exec', data: { proposal } });

      // Execute → Review
      if (canTransition(state.mode, 'review')) {
        state.mode = 'review';
        state.version++;
        trace.append({ ts: Date.now(), kind: 'state', data: { modeTransition: 'execute→review' } });
      }
      continue;
    }

    // ── Step 5+6: Review 模式 ───────────────────────────────
    if (state.mode === 'review') {
      const outcomeResult = await llm.judge('outcome', collectResult.context,
        `目标: ${state.currentSubgoal ?? state.goal}\n执行提案: ${state.custom['pendingProposal']}`);
      trace.append({
        ts: Date.now(), kind: 'judge',
        data: { type: 'outcome', decision: outcomeResult.result },
        uncertainty: outcomeResult.uncertainty,
      });

      const achieved = outcomeResult.result.toLowerCase().includes('达成') || outcomeResult.result.toLowerCase().includes('pass');

      if (!achieved || outcomeResult.uncertainty.score > t.uncertaintyHigh) {
        state.noProgressCount++;
        // 进入 Recovery 或重新 Plan
        if (state.noProgressCount >= t.maxNoProgress) continue; // 下次迭代触发 Escalate
        if (canTransition(state.mode, 'recovery')) {
          state.mode = 'recovery';
          state.version++;
          trace.append({ ts: Date.now(), kind: 'state', data: { modeTransition: 'review→recovery' } });
        }
        continue;
      }

      // 子目标完成
      state.noProgressCount = 0;
      if (state.currentSubgoal) {
        state.subgoals = state.subgoals.filter(g => g !== state.currentSubgoal);
        state.currentSubgoal = state.subgoals[0] ?? null;
      }

      // 仍有子目标 → 回 Plan
      if (state.subgoals.length > 0) {
        if (canTransition(state.mode, 'plan')) {
          state.mode = 'plan';
          state.version++;
        }
      }
      // 否则下次迭代检测到 goal_completed → Stop
      continue;
    }

    // ── Recovery 模式 ───────────────────────────────────────
    if (state.mode === 'recovery') {
      trace.append({ ts: Date.now(), kind: 'state', data: { mode: 'recovery', action: '诊断与回退' } });
      // 只允许 bash(git) 和 read（L1.2），实际回退由 harness 执行
      await harness.rollback();
      if (canTransition(state.mode, 'plan')) {
        state.mode = 'plan';
        state.version++;
        state.custom['pendingProposal'] = null;
        trace.append({ ts: Date.now(), kind: 'state', data: { modeTransition: 'recovery→plan' } });
      }
    }
  }
}
```

---

## 八、L0.6 — Harness（版本快照）

```typescript
// harness.ts

import type { Primitives } from './primitives';

export class Harness {
  private snapshots: string[] = [];

  constructor(private primitives: Primitives, private workDir: string = '.') {}

  // 只对可能产生持久副作用的操作调用（只读 bash 不需要）
  async snapshot(label: string): Promise<boolean> {
    try {
      await this.primitives.bash(
        `cd ${this.workDir} && git add -A && git commit -m "[agent-snapshot] ${label}" --allow-empty`
      );
      const hash = (await this.primitives.bash(`cd ${this.workDir} && git rev-parse HEAD`)).trim();
      this.snapshots.push(hash);
      return true;
    } catch {
      return false; // 快照失败，调用方负责阻断
    }
  }

  // 回退到最近快照（Judge 或用户触发，共用同一机制）
  async rollback(): Promise<boolean> {
    const target = this.snapshots[this.snapshots.length - 2]; // 上一个快照
    if (!target) return false;
    try {
      await this.primitives.bash(`cd ${this.workDir} && git checkout ${target}`);
      return true;
    } catch {
      return false;
    }
  }
}
```

---

## 九、SDK 对外入口

```typescript
// index.ts

export { localPrimitives, type Primitives } from './primitives';
export { LLMCall, type LLMProvider, type JudgeType } from './llm';
export { collect, type CollectConfig, type CollectSource } from './collect';
export { runLoop, type LoopConfig, type LoopResult } from './loop';
export { Harness } from './harness';
export { Trace, type TraceEntry, type Confidence, type Uncertainty } from './trace';
export {
  createInitialState, canTransition,
  type AgentState, type PermissionLevel, type Mode,
} from './state';
```

---

## 十、使用示例（Prompt opencode 场景）

```typescript
// example-app.ts — 上层应用调用 SDK

import {
  localPrimitives, LLMCall, Trace, Harness,
  createInitialState, runLoop,
} from 'agent-runtime-core';

// 1. 实现 LLMProvider 接口（接入具体模型）
const myProvider = {
  async complete(system: string, user: string): Promise<string> {
    // 对接 OpenAI / Anthropic / 本地模型 ...
    throw new Error('请替换为真实模型调用');
  },
};

// 2. 初始化 SDK 组件
const primitives = localPrimitives;
const llm = new LLMCall(myProvider);
const trace = new Trace();
const harness = new Harness(primitives, '/path/to/project');

// 3. 构建初始 State（权限级别 2 = 受控执行）
const state = createInitialState('修复 issue #42：空指针异常', 2);
state.subgoals = ['定位触发路径', '编写修复代码', '更新单元测试'];
state.currentSubgoal = state.subgoals[0];

// 4. 运行循环
const result = await runLoop(
  state,
  {
    collectConfig: {
      sources: [
        { type: 'file', query: 'AGENTS.md' },            // L0.5 静态上下文
        { type: 'bash', query: 'rg -n "NullPointer" src/' }, // L1.3 精确代码搜索
        { type: 'trace_tag', query: 'issue-42' },         // L1.4 标签检索
      ],
      maxTokens: 4000,  // L1.6 上下文预算
    },
    onEscalate: async (reason, s) => {
      console.warn('[ESCALATE]', reason, 'mode:', s.mode);
      // 通知人类介入或记录告警
    },
    onStop: async (s) => {
      console.log('[STOP] 任务完成，迭代次数:', s.iterationCount);
    },
  },
  primitives,
  llm,
  trace,
  harness,
);

console.log('结果:', result.status);
console.log('Trace 条数:', trace.all().length);
// trace.serialize() 可写入文件供事后调试
```

---

## 十一、原则对照表

| SDK 模块 | 对应原则条款 |
|----------|-------------|
| `trace.ts` | 质量信号写入 Trace（总规则）|
| `primitives.ts` | L0.1 四个执行原语，接口冻结 |
| `llm.ts` (Reason/Judge) | L0.2 两种模式，Judge 必须显式 type |
| `collect.ts` | L0.3 编排协议，coverage/reliability 分离 |
| `loop.ts` 终止条件 | L0.4 终止条件是一等概念 |
| `harness.ts` | L0.6 快照失败默认阻断，以变更批次为单位 |
| `state.ts` PermissionLevel | L1.1 权限状态机，升级需显式申请 |
| `state.ts` Mode + 切换表 | L1.2 Role/Mode 状态机，切换规则完整 |
| `collect.ts` bash ripgrep | L1.3 精确代码搜索优先于向量索引 |
| `trace.filterByTag` | L1.4 标签/书签约定 |
| `LLMProvider` 接口 | L1.5 提供商无关抽象 |
| `collectConfig.maxTokens` | L1.6 上下文窗口预算管理 |

---

## 十二、永远不要做的事（SDK 层面）

- 修改 `primitives.ts` 中任何函数的签名
- 在 `loop.ts` 之外直接调用 `primitives`（绕过 Harness 和权限检查）
- 用 `judge('any', ...)` 代替显式 `type`
- 在 `collect.ts` 外部手动拼接 context 字符串（会绕过 confidence 计算）
- 忽略 `snapshot()` 返回值（`false` 必须阻断后续执行）
- 在没有 `canTransition` 检查的情况下直接赋值 `state.mode`
