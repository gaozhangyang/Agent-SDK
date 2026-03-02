import { type Primitives } from './core/primitives';
import { LLMCall, type LLMProvider, type JudgeType, type LLMCallResult, type LLMCallMulti } from './core/llm';
import { collect, type CollectConfig, type CollectSource, type CollectResult } from './core/collect';
import { Trace, TerminalLog, type TraceEntry, type TerminalEntry, type Confidence, type Uncertainty } from './core/trace';
import { Memory, type MemoryEntry } from './core/memory';
import { Harness } from './runtime/harness';
import { runLoop, type LoopConfig, type LoopResult, type LoopHooks, type LoopDeps } from './runtime/loop';
import { StateManager, canTransition, createInitialState, type AgentState, type PermissionLevel, type Mode } from './runtime/state';
import { InterruptChannel, type InterruptSignal, type UserDirective } from './runtime/interrupt';
import { createModeHooks } from './hooks/mode-state-machine';
import { createPermissionHooks } from './hooks/permission-guard';
import { createErrorClassifier } from './hooks/error-classifier';
export { type Primitives };
export { LLMCall, type LLMProvider, type JudgeType, type LLMCallResult, type LLMCallMulti };
export { collect, type CollectConfig, type CollectSource, type CollectResult };
export { Trace, TerminalLog, type TraceEntry, type TerminalEntry, type Confidence, type Uncertainty };
export { Memory, type MemoryEntry };
export { Harness };
export { runLoop, type LoopConfig, type LoopResult, type LoopHooks, type LoopDeps };
export { canTransition, createInitialState, type AgentState, type PermissionLevel, type Mode };
export { StateManager };
export { InterruptChannel, type InterruptSignal, type UserDirective };
export { createModeHooks };
export { createPermissionHooks };
export { createErrorClassifier };
export interface MetaAgent {
    run(loopConfig?: Partial<LoopConfig>): Promise<LoopResult>;
    interrupt(message: string): void;
    getState(): AgentState;
    getTrace(): Trace;
    getTerminalLog(): TerminalLog;
    getMemory(): Memory;
}
export declare function createMetaAgent(projectPath: string, goal: string, llmProvider: LLMProvider, options?: {
    permissions?: PermissionLevel;
    subgoals?: string[];
    logToFile?: boolean;
    hooks?: LoopHooks;
    collectConfig?: CollectConfig;
}): Promise<MetaAgent>;
//# sourceMappingURL=index.d.ts.map