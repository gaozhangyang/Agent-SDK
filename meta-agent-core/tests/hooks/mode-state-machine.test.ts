// tests/hooks/mode-state-machine.test.ts

import { createModeHooks } from '../../src/hooks/mode-state-machine';
import { createInitialState } from '../../src/runtime/state';
import { Trace } from '../../src/core/trace';

describe('ModeStateMachine', () => {
  test('onModeTransition 非法切换触发警告，不 crash', async () => {
    const trace = new Trace();
    const hooks = createModeHooks(trace);
    
    const state = createInitialState('test');
    
    // 尝试非法切换 plan -> review
    await hooks.onModeTransition!('plan', 'review', state);
    
    // 应该产生警告日志，但不会抛错
    const entries = trace.all();
    expect(entries.some(e => e.kind === 'narrative')).toBe(true);
  });

  test('onAfterObserve 含 recover 返回 recover', async () => {
    const hooks = createModeHooks();
    const state = createInitialState('test');
    
    const result = await hooks.onAfterObserve!(state, '需要 recover');
    expect(result).toBe('recover');
  });

  test('onAfterObserve 含 失败 返回 recover', async () => {
    const hooks = createModeHooks();
    const state = createInitialState('test');
    
    const result = await hooks.onAfterObserve!(state, '执行失败');
    expect(result).toBe('recover');
  });

  test('onAfterObserve 其他情况返回 continue', async () => {
    const hooks = createModeHooks();
    const state = createInitialState('test');
    
    const result = await hooks.onAfterObserve!(state, '执行成功');
    expect(result).toBe('continue');
  });

  test('合法切换不触发警告', async () => {
    const trace = new Trace();
    const hooks = createModeHooks(trace);
    
    const state = createInitialState('test');
    
    // 合法切换 plan -> execute
    await hooks.onModeTransition!('plan', 'execute', state);
    
    const entries = trace.all();
    const warnings = entries.filter(e => 
      e.kind === 'narrative' && e.data && (e.data as any).type === 'mode_transition_warning'
    );
    expect(warnings).toHaveLength(0);
  });
});
