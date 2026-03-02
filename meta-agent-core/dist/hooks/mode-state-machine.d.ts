import type { LoopHooks } from '../runtime/loop';
import { Trace } from '../core/trace';
/**
 * 创建 Mode 状态机 Hooks
 */
export declare function createModeHooks(trace?: Trace): Pick<LoopHooks, 'onModeTransition' | 'onAfterObserve'>;
//# sourceMappingURL=mode-state-machine.d.ts.map