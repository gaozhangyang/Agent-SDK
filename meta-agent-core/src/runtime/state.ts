// [编排层 / 状态] runtime/state.ts — AgentState + StateManager（持久化）

import fs from 'fs/promises';
import path from 'path';

export type PermissionLevel = 0 | 1 | 2 | 3 | 4;
export type Mode = 'plan' | 'execute' | 'review' | 'recovery' | 'paused';

export type SubgoalOutcome = 'completed' | 'voided';

export type ArchivedSubgoal = {
  goal: string;
  summary: string;           // 该子目标的解决结论
  outcome: SubgoalOutcome;  // voided = 被 Recovery 回滚，此路不通
};

export type AgentState = {
  goal: string;
  subgoals: string[];
  currentSubgoal: string | null;
  archivedSubgoals: ArchivedSubgoal[];  // v2 新增：已完成子目标，包含结论和结果
  mode: Mode;
  permissions: PermissionLevel;
  iterationCount: number;
  noProgressCount: number;
  version: number;
  custom: Record<string, unknown>;
};

// Mode 合法切换表
export const MODE_TRANSITIONS: Record<Mode, (Mode | 'stop')[]> = {
  plan: ['execute', 'recovery'],
  execute: ['review', 'recovery', 'plan'],
  review: ['execute', 'plan', 'recovery'],
  recovery: ['plan'],
  paused: ['plan', 'stop'],  // stop 用字符串表示，由 Loop 处理
};

// 任意 mode → paused 都合法
export function canTransition(from: Mode, to: Mode): boolean {
  if (to === 'paused') return true;  // 任何 mode → paused 合法
  const allowed = MODE_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

/**
 * StateManager：Session 持久化与跨 Session 恢复
 */
export class StateManager {
  /**
   * 加载 State
   * 读取 {agentDir}/state.json，不存在返回 null，解析失败也返回 null
   */
  async load(agentDir: string): Promise<AgentState | null> {
    const statePath = path.join(agentDir, 'state.json');
    try {
      const content = await fs.readFile(statePath, 'utf-8');
      return JSON.parse(content) as AgentState;
    } catch {
      return null;
    }
  }

  /**
   * 保存 State
   * 原子写入：先写 .tmp，再 rename 为 .json
   */
  async save(agentDir: string, state: AgentState): Promise<void> {
    const statePath = path.join(agentDir, 'state.json');
    const tmpPath = statePath + '.tmp';
    try {
      await fs.mkdir(agentDir, { recursive: true });
      await fs.writeFile(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
      await fs.rename(tmpPath, statePath);
    } catch (error) {
      // 如果 rename 失败，尝试删除 tmp 文件
      try {
        await fs.unlink(tmpPath);
      } catch {}
      throw error;
    }
  }

  /**
   * 创建初始 State
   */
  createInitial(goal: string, permissions: PermissionLevel = 2): AgentState {
    return {
      goal,
      subgoals: [],
      currentSubgoal: null,
      archivedSubgoals: [],
      mode: 'plan',
      permissions,
      iterationCount: 0,
      noProgressCount: 0,
      version: 0,
      custom: {},
    };
  }
}

// 兼容 v1 的调用方式
export function createInitialState(goal: string, permissions: PermissionLevel = 2): AgentState {
  return new StateManager().createInitial(goal, permissions);
}
