import { type CollectConfig } from '../core/collect';
import { LLMCall } from '../core/llm';
import { Trace, TerminalLog } from '../core/trace';
import { Memory } from '../core/memory';
import { Harness } from './harness';
import { type AgentState, type Mode } from './state';
import { InterruptChannel, type InterruptSignal, type UserDirective } from './interrupt';
import { StateManager } from './state';
import type { Primitives } from '../core/primitives';
export declare const DEFAULT_THRESHOLDS: {
    confidenceLow: number;
    confidenceMid: number;
    uncertaintyHigh: number;
    maxCollectRetry: number;
    maxNoProgress: number;
    maxIterations: number;
};
export type LoopHooks = {
    onBeforeExec?: (state: AgentState, proposal: string) => Promise<'proceed' | 'block'>;
    onAfterObserve?: (state: AgentState, result: string) => Promise<'continue' | 'recover' | 'escalate'>;
    onModeTransition?: (from: Mode, to: Mode, state: AgentState) => Promise<void>;
    shouldSnapshot?: (state: AgentState) => Promise<boolean>;
    classifyError?: (error: unknown) => 'retryable' | 'logic' | 'environment' | 'budget';
    onInterrupt?: (signal: InterruptSignal, state: AgentState) => Promise<UserDirective>;
};
export type LoopDeps = {
    primitives: Primitives;
    llm: LLMCall;
    trace: Trace;
    terminalLog: TerminalLog;
    memory: Memory;
    harness: Harness;
    interrupt: InterruptChannel;
    stateManager: StateManager;
    agentDir: string;
    skillsDir?: string;
};
export type LoopConfig = {
    collectConfig: CollectConfig;
    thresholds?: Partial<typeof DEFAULT_THRESHOLDS>;
    onEscalate?: (reason: string, state: AgentState) => Promise<void>;
    onStop?: (state: AgentState) => Promise<void>;
};
export type LoopResult = {
    status: 'completed';
    state: AgentState;
} | {
    status: 'escalated';
    reason: string;
    state: AgentState;
} | {
    status: 'budget_exceeded';
    state: AgentState;
};
/**
 * 运行 Agent 循环
 * 必须严格按 Loop 顺序执行
 */
export declare function runLoop(state: AgentState, config: LoopConfig, deps: LoopDeps, hooks?: LoopHooks): Promise<LoopResult>;
//# sourceMappingURL=loop.d.ts.map