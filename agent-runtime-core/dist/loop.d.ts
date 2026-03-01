/**
 * L0.4 + L1.1 + L1.2 — 核心执行循环
 *
 * 包含权限状态机（L1.1）和 Role/Mode 状态机（L1.2）
 * 终止条件是一等概念
 */
import { type CollectConfig } from './collect';
import { LLMCall } from './llm';
import { Trace } from './trace';
import { Harness } from './harness';
import { type AgentState } from './state';
import type { Primitives } from './primitives';
declare const DEFAULT_THRESHOLDS: {
    confidenceLow: number;
    confidenceMid: number;
    uncertaintyHigh: number;
    maxCollectRetry: number;
    maxNoProgress: number;
    maxIterations: number;
};
export type LoopConfig = {
    collectConfig: CollectConfig;
    thresholds?: Partial<typeof DEFAULT_THRESHOLDS>;
    onEscalate?: (reason: string, state: AgentState) => Promise<void>;
    onStop?: (state: AgentState) => Promise<void>;
    workDir?: string;
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
 * 核心执行循环
 *
 * @param state - 初始状态
 * @param config - 循环配置
 * @param primitives - 执行原语
 * @param llm - LLM 调用
 * @param trace - 追踪系统
 * @param harness - 版本快照
 */
export declare function runLoop(state: AgentState, config: LoopConfig, primitives: Primitives, llm: LLMCall, trace: Trace, harness: Harness): Promise<LoopResult>;
export {};
//# sourceMappingURL=loop.d.ts.map