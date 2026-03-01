/**
 * Agent Runtime Core SDK
 *
 * 基于《Coding Agent 设计原则分级指南》L0 + L1 的最简约实现方案
 * 面向 opencode prompt / 系统集成，作为可复用 SDK 供上层应用调用
 */
export { localPrimitives, type Primitives } from './primitives';
export { LLMCall, type LLMProvider, type JudgeType, type LLMCallResult, type LLMCallMulti } from './llm';
export { collect, type CollectConfig, type CollectSource, type CollectResult } from './collect';
export { runLoop, type LoopConfig, type LoopResult } from './loop';
export { Harness } from './harness';
export { Trace, type TraceEntry, type TraceEntryKind, type Confidence, type Uncertainty } from './trace';
export { createInitialState, canTransition, getValidTransitions, type AgentState, type PermissionLevel, type Mode, } from './state';
//# sourceMappingURL=index.d.ts.map