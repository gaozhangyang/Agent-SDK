// [策略层 / 模式] hooks/mode-state-machine.ts — Mode 切换规则（标准 Hook 实现）

import type { AgentState, Mode } from '../runtime/state';
import type { LoopHooks } from '../runtime/loop';
import { canTransition } from '../runtime/state';
import { Trace } from '../core/trace';

/**
 * 创建 Mode 状态机 Hooks
 */
export function createModeHooks(trace?: Trace): Pick<LoopHooks, 'onModeTransition' | 'onAfterObserve'> {
  return {
    /**
     * 校验切换合法性
     * 非法切换写 Trace 警告（不阻断，Loop 骨架的 canTransition 已阻断）
     */
    onModeTransition: async (from: Mode, to: Mode, state: AgentState) => {
      if (!canTransition(from, to)) {
        const warning = `警告：非法的 Mode 切换 ${from} → ${to}`;
        console.warn(warning);
        trace?.append({
          ts: Date.now(),
          kind: 'narrative',
          data: { type: 'mode_transition_warning', from, to, warning },
        });
      }
    },

    /**
     * 根据结果字符串判断后续动作
     */
    onAfterObserve: async (_state: AgentState, result: string) => {
      const lowerResult = result.toLowerCase();
      if (lowerResult.includes('recover') || lowerResult.includes('失败')) {
        return 'recover';
      }
      return 'continue';
    },
  };
}
