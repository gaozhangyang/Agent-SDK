import { type CollectConfig, type CollectSource } from '../core/collect';
import { LLMCall } from '../core/llm';
import { Trace, TerminalLog, type Confidence } from '../core/trace';
import { Memory } from '../core/memory';
import { Harness } from './harness';
import { type AgentState, type Mode, type EnvironmentCapabilities } from './state';
import { InterruptChannel, type InterruptSignal, type UserDirective } from './interrupt';
import { StateManager } from './state';
import type { Primitives } from '../core/primitives';
export declare const DEFAULT_THRESHOLDS: {
    confidenceLow: number;
    confidenceMid: number;
    uncertaintyHigh: number;
    maxNoProgress: number;
    maxIterations: number;
};
/**
 * Collect 策略函数类型
 */
export type CollectFn = (sources: CollectSource[], limits: {
    maxTokens?: number;
    filters?: string[];
}) => Promise<{
    rawContext: string;
    confidence: Confidence;
    mode: 'normal' | 'degraded';
}>;
/**
 * 构建证据束函数类型
 */
export type EvidenceBundleFn = (state: AgentState, lastExecResult: string) => Promise<{
    evidence: string;
    summary: string;
}>;
/**
 * 可分类错误类型
 */
export type ClassifiableError = {
    kind: 'execution';
    error: Error;
    terminalSeq: number;
} | {
    kind: 'semantic';
    judgeResult: string;
    subgoal: string;
} | Error | unknown;
/**
 * 错误分类
 */
export type ErrorClass = 'retryable' | 'logic' | 'environment' | 'budget';
export type LoopHooks = {
    collect?: CollectFn;
    buildEvidenceBundle?: EvidenceBundleFn;
    onBeforeExec?: (state: AgentState, proposal: string) => Promise<'proceed' | 'block'>;
    onAfterObserve?: (state: AgentState, result: string) => Promise<'continue' | 'recover' | 'escalate'>;
    onModeTransition?: (from: Mode, to: Mode, state: AgentState) => Promise<void>;
    shouldSnapshot?: (state: AgentState) => Promise<boolean>;
    classifyError?: (error: ClassifiableError) => ErrorClass;
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
    contextBudget?: {
        total: number;
        reservedSystemPrompt: number;
        reservedOutput: number;
    };
};
export type LoopResult = {
    status: 'completed';
    state: AgentState;
    terminalSeq?: number;
} | {
    status: 'escalated';
    reason: string;
    state: AgentState;
    escalationReason?: string;
    humanActionRequired?: string;
} | {
    status: 'budget_exceeded';
    state: AgentState;
} | {
    status: 'interrupted';
    state: AgentState;
    humanActionRequired?: string;
};
/**
 * ContextBudget 配置
 */
export interface ContextBudgetConfig {
    total: number;
    reservedSystemPrompt: number;
    reservedOutput: number;
}
/**
 * 检查上下文预算是否足够
 * @param currentTokens 当前上下文长度（字符数 / 4 ≈ token）
 * @param budget 预算配置
 * @returns { sufficient: boolean; required: number; available: number }
 */
export declare function checkContextBudget(currentTokens: number, budget?: ContextBudgetConfig): {
    sufficient: boolean;
    required: number;
    available: number;
};
/**
 * 检测 git 是否可用
 */
export declare function checkGitAvailable(primitives: Primitives): Promise<boolean>;
/**
 * 探测环境能力
 */
export declare function detectEnvironmentCapabilities(primitives: Primitives): Promise<EnvironmentCapabilities>;
/**
 * 运行 Agent 循环
 * 必须严格按 Loop 顺序执行
 */
export declare function runLoop(state: AgentState, config: LoopConfig, deps: LoopDeps, hooks?: LoopHooks): Promise<LoopResult>;
//# sourceMappingURL=loop.d.ts.map