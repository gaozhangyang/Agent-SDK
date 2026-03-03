import { type Primitives } from './core/primitives';
import { LLMCall, type LLMProvider, type JudgeType, type LLMCallResult, type LLMCallMulti } from './core/llm';
import { collect, type CollectConfig, type CollectSource, type CollectResult } from './core/collect';
import { Trace, TerminalLog, GlobalSeqManager, type TraceEntry, type TerminalEntry, type Confidence, type Uncertainty } from './core/trace';
import { Memory, type MemoryEntry, type Subgoal } from './core/memory';
import { Harness } from './runtime/harness';
import { runLoop, type LoopConfig, type LoopResult, type LoopHooks, type LoopDeps } from './runtime/loop';
import { StateManager, canTransition, createInitialState, type AgentState, type PermissionLevel, type Mode, type ArchivedSubgoal, type SubgoalOutcome } from './runtime/state';
import { InterruptChannel, type InterruptSignal, type UserDirective } from './runtime/interrupt';
import { createModeHooks } from './hooks/mode-state-machine';
import { createPermissionHooks } from './hooks/permission-guard';
import { createErrorClassifier } from './hooks/error-classifier';
export { type Primitives };
export { LLMCall, type LLMProvider, type JudgeType, type LLMCallResult, type LLMCallMulti };
export { collect, type CollectConfig, type CollectSource, type CollectResult };
export { Trace, TerminalLog, GlobalSeqManager, type TraceEntry, type TerminalEntry, type Confidence, type Uncertainty };
export { Memory, type MemoryEntry, type Subgoal };
export { Harness };
export { runLoop, type LoopConfig, type LoopResult, type LoopHooks, type LoopDeps };
export { canTransition, createInitialState, type AgentState, type PermissionLevel, type Mode, type ArchivedSubgoal, type SubgoalOutcome };
export { StateManager };
export { InterruptChannel, type InterruptSignal, type UserDirective };
export { createModeHooks };
export { createPermissionHooks };
export { createErrorClassifier };
/**
 * AGENT.md 中定义的策略层配置
 * 来自 change.md 修改四：AGENT.md 增加策略层配置
 */
export interface AgentStrategiesConfig {
    level?: 'L0' | 'L1' | 'L2' | 'L3';
    permissions?: PermissionLevel;
    mode_fsm?: 'enabled' | 'disabled';
    permission_fsm?: 'enabled' | 'disabled';
    harness?: 'standard' | 'aggressive' | 'disabled';
    error_classifier?: 'enabled' | 'disabled';
    judge?: {
        outcome?: 'required' | 'rule_based' | 'disabled';
        milestone?: 'enabled' | 'disabled';
        capability?: 'enabled' | 'disabled';
    };
}
/**
 * 从 AGENT.md 内容中解析策略层配置
 * 支持两种格式：
 * 1. ```json 代码块中的 JSON 格式
 * 2. YAML 格式（向后兼容）
 */
export declare function parseStrategiesConfig(agentMdContent?: string): AgentStrategiesConfig;
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
    agentMdContent?: string;
    skillsDir?: string;
}): Promise<MetaAgent>;
//# sourceMappingURL=index.d.ts.map