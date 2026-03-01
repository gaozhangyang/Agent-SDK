/**
 * L1.1 + L1.2 — State 结构体（权限 + Mode）
 * 
 * 权限状态机：存储在 State.permissions，分五级
 * Mode 状态机：存储在 State.mode，每次切换记录到 Trace
 */

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

/**
 * 创建初始状态
 */
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

/**
 * 检查 Mode 是否可以切换
 */
export function canTransition(from: Mode, to: Mode): boolean {
  return MODE_TRANSITIONS[from].includes(to);
}

/**
 * 获取所有合法的切换目标
 */
export function getValidTransitions(from: Mode): Mode[] {
  return MODE_TRANSITIONS[from];
}
