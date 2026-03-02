// 对外入口 index.ts — 导出所有模块 + createMetaAgent 工厂

import path from 'path';
import fs from 'fs/promises';
import { localPrimitives, type Primitives } from './core/primitives';
import { LLMCall, type LLMProvider, type JudgeType, type LLMCallResult, type LLMCallMulti } from './core/llm';
import { collect, type CollectConfig, type CollectSource, type CollectResult } from './core/collect';
import { Trace, TerminalLog, type TraceEntry, type TerminalEntry, type Confidence, type Uncertainty } from './core/trace';
import { Harness } from './runtime/harness';
import { runLoop, type LoopConfig, type LoopResult, type LoopHooks, type LoopDeps } from './runtime/loop';
import { StateManager, canTransition, createInitialState, type AgentState, type PermissionLevel, type Mode } from './runtime/state';
import { InterruptChannel, type InterruptSignal, type UserDirective } from './runtime/interrupt';
import { createModeHooks } from './hooks/mode-state-machine';
import { createPermissionHooks } from './hooks/permission-guard';
import { createErrorClassifier } from './hooks/error-classifier';

// ── 导出所有模块（兼容 v1 的导出方式，额外导出 v2 新增内容）──────────────────

// 兼容 v1
export { type Primitives };
export { LLMCall, type LLMProvider, type JudgeType, type LLMCallResult, type LLMCallMulti };
export { collect, type CollectConfig, type CollectSource, type CollectResult };
export { Trace, TerminalLog, type TraceEntry, type TerminalEntry, type Confidence, type Uncertainty };
export { Harness };
export { runLoop, type LoopConfig, type LoopResult, type LoopHooks, type LoopDeps };
export { canTransition, createInitialState, type AgentState, type PermissionLevel, type Mode };

// v2 新增
export { StateManager };
export { InterruptChannel, type InterruptSignal, type UserDirective };
export { createModeHooks };
export { createPermissionHooks };
export { createErrorClassifier };

// ── createMetaAgent 工厂函数 ─────────────────────────────────────────────────

export interface MetaAgent {
  run(loopConfig?: Partial<LoopConfig>): Promise<LoopResult>;
  interrupt(message: string): void;
  getState(): AgentState;
  getTrace(): Trace;
  getTerminalLog(): TerminalLog;
}

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
): Promise<MetaAgent> {
  // 1. 创建 .agent/ 目录
  const agentDir = path.join(projectPath, '.agent');
  await fs.mkdir(agentDir, { recursive: true });

  // 2. 初始化 Trace 和 TerminalLog
  const traceLogPath = options?.logToFile ? path.join(agentDir, 'trace.jsonl') : undefined;
  const terminalLogPath = options?.logToFile ? path.join(agentDir, 'terminal.jsonl') : undefined;
  
  const trace = new Trace(traceLogPath);
  const terminalLog = new TerminalLog(terminalLogPath);

  // 3. 用 localPrimitives 创建原语
  // coreDir 为当前 SDK 的 src/ 目录绝对路径
  const coreDir = path.resolve(__dirname, '..');
  const primitives = localPrimitives(coreDir, terminalLog);

  // 4. 用 StateManager 尝试恢复 State，失败则 createInitial
  const stateManager = new StateManager();
  let state = await stateManager.load(agentDir);
  
  if (!state) {
    state = stateManager.createInitial(goal, options?.permissions ?? 2);
    if (options?.subgoals) {
      state.subgoals = options.subgoals;
      state.currentSubgoal = options.subgoals[0] ?? null;
    }
    await stateManager.save(agentDir, state);
  }

  // 5. 组合标准 hooks：createModeHooks() + createPermissionHooks() + createErrorClassifier()
  // options.hooks 优先级高于标准 hooks
  const standardHooks: LoopHooks = {
    ...createModeHooks(trace),
    ...createPermissionHooks(),
    ...createErrorClassifier(),
  };
  const mergedHooks: LoopHooks = {
    ...standardHooks,
    ...options?.hooks,
    // 合并嵌套的 hook 函数
    onModeTransition: options?.hooks?.onModeTransition ?? standardHooks.onModeTransition,
    onBeforeExec: options?.hooks?.onBeforeExec ?? standardHooks.onBeforeExec,
    onAfterObserve: options?.hooks?.onAfterObserve ?? standardHooks.onAfterObserve,
    shouldSnapshot: options?.hooks?.shouldSnapshot ?? standardHooks.shouldSnapshot,
    classifyError: options?.hooks?.classifyError ?? standardHooks.classifyError,
    onInterrupt: options?.hooks?.onInterrupt ?? standardHooks.onInterrupt,
  };

  // 6. 创建 LLMCall 实例
  const llm = new LLMCall(llmProvider);

  // 7. 创建 Harness 和 InterruptChannel
  const harness = new Harness(primitives, projectPath, agentDir);
  const interrupt = new InterruptChannel();

  // 8. 构建 LoopDeps
  const deps: LoopDeps = {
    primitives,
    llm,
    trace,
    terminalLog,
    harness,
    interrupt,
    stateManager,
    agentDir,
  };

  // 9. 返回 MetaAgent 对象
  return {
    run: async (loopConfig?: Partial<LoopConfig>): Promise<LoopResult> => {
      const fullConfig: LoopConfig = {
        collectConfig: options?.collectConfig ?? { sources: [] },
        ...loopConfig,
      };
      return runLoop(state!, fullConfig, deps, mergedHooks);
    },

    interrupt: (message: string): void => {
      interrupt.push({ message, ts: Date.now() });
    },

    getState: (): AgentState => state!,
    getTrace: (): Trace => trace,
    getTerminalLog: (): TerminalLog => terminalLog,
  };
}
