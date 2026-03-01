/**
 * L1.1 + L1.2 — State 结构体（权限 + Mode）
 *
 * 权限状态机：存储在 State.permissions，分五级
 * Mode 状态机：存储在 State.mode，每次切换记录到 Trace
 */
export type PermissionLevel = 0 | 1 | 2 | 3 | 4;
export type Mode = 'plan' | 'execute' | 'review' | 'recovery';
export type AgentState = {
    goal: string;
    subgoals: string[];
    currentSubgoal: string | null;
    mode: Mode;
    permissions: PermissionLevel;
    iterationCount: number;
    noProgressCount: number;
    version: number;
    custom: Record<string, unknown>;
};
/**
 * 创建初始状态
 */
export declare function createInitialState(goal: string, permissions?: PermissionLevel): AgentState;
export declare const MODE_TRANSITIONS: Record<Mode, Mode[]>;
/**
 * 检查 Mode 是否可以切换
 */
export declare function canTransition(from: Mode, to: Mode): boolean;
/**
 * 获取所有合法的切换目标
 */
export declare function getValidTransitions(from: Mode): Mode[];
//# sourceMappingURL=state.d.ts.map