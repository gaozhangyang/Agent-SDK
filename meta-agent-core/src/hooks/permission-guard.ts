// [策略层 / 权限] hooks/permission-guard.ts — 权限检查（标准 Hook 实现）

import type { AgentState, PermissionLevel } from '../runtime/state';
import type { LoopHooks } from '../runtime/loop';

/**
 * 权限检查规则
 * | 操作特征 | 需要的最低权限 |
 * |---------|-------------|
 * | rm -rf / delete / DROP / truncate | Level 3 |
 * | curl / wget / fetch / http / https | Level 3 |
 * | write( / edit( / fs.write | Level 1 |
 * | bash( / exec( / spawn( | Level 2 |
 * | 其他 | Level 0 |
 */

const PERMISSION_RULES: Array<{
  pattern: RegExp;
  requiredLevel: PermissionLevel;
}> = [
  { pattern: /rm\s+-rf|delete\s+|DROP\s+|truncate\s+/i, requiredLevel: 3 },
  { pattern: /curl|wget|fetch|http:|https:/i, requiredLevel: 3 },
  { pattern: /write\s*\(|edit\s*\(|fs\.write/i, requiredLevel: 1 },
  { pattern: /bash\s*\(|exec\s*\(|spawn\s*\(/i, requiredLevel: 2 },
];

/**
 * 判断操作需要的最低权限
 */
function getRequiredLevel(proposal: string): PermissionLevel {
  for (const rule of PERMISSION_RULES) {
    if (rule.pattern.test(proposal)) {
      return rule.requiredLevel;
    }
  }
  return 0;
}

/**
 * 创建权限检查 Hooks
 */
export function createPermissionHooks(): Pick<LoopHooks, 'onBeforeExec'> {
  return {
    /**
     * 检查当前权限是否满足操作需求
     */
    onBeforeExec: async (state: AgentState, proposal: string): Promise<'proceed' | 'block'> => {
      const requiredLevel = getRequiredLevel(proposal);

      if (state.permissions < requiredLevel) {
        const message = `权限不足：需要 Level ${requiredLevel}，当前 Level ${state.permissions}。操作：${proposal.slice(0, 50)}...`;
        console.warn(`[PermissionGuard] ${message}`);
        return 'block';
      }

      return 'proceed';
    },
  };
}
