export type PermissionLevel = 0 | 1 | 2 | 3 | 4;
export type Mode = 'plan' | 'execute' | 'review' | 'recovery' | 'paused';
export type SubgoalOutcome = 'completed' | 'voided';
export type ArchivedSubgoal = {
    goal: string;
    summary: string;
    outcome: SubgoalOutcome;
};
export type AgentState = {
    goal: string;
    subgoals: string[];
    currentSubgoal: string | null;
    archivedSubgoals: ArchivedSubgoal[];
    pendingProposal?: string;
    lastExecResult?: string;
    mode: Mode;
    permissions: PermissionLevel;
    iterationCount: number;
    noProgressCount: number;
    version: number;
    custom: Record<string, unknown>;
};
export declare const MODE_TRANSITIONS: Record<Mode, (Mode | 'stop')[]>;
export declare function canTransition(from: Mode, to: Mode): boolean;
/**
 * StateManager：Session 持久化与跨 Session 恢复
 */
export declare class StateManager {
    /**
     * 加载 State
     * 读取 {agentDir}/state.json，不存在返回 null，解析失败也返回 null
     * 如果字段缺失，填充默认值
     */
    load(agentDir: string): Promise<AgentState | null>;
    /**
     * 保存 State
     * 原子写入：先写 .tmp，再 rename 为 .json
     */
    save(agentDir: string, state: AgentState): Promise<void>;
    /**
     * 创建初始 State
     */
    createInitial(goal: string, permissions?: PermissionLevel): AgentState;
}
export declare function createInitialState(goal: string, permissions?: PermissionLevel): AgentState;
//# sourceMappingURL=state.d.ts.map