/**
 * state.test.ts
 * 
 * 测试点：
 * - createInitialState() 默认 mode 为 'plan'
 * - canTransition('plan', 'execute') 返回 true
 * - canTransition('plan', 'review') 返回 false
 * - canTransition('recovery', 'execute') 返回 false
 * - 覆盖所有合法切换路径
 */

import { 
  createInitialState, 
  canTransition, 
  getValidTransitions,
  type Mode 
} from '../src/state';

describe('state', () => {
  describe('createInitialState()', () => {
    it("createInitialState() 默认 mode 为 'plan'", () => {
      const state = createInitialState('Test goal');
      
      expect(state.mode).toBe('plan');
      expect(state.goal).toBe('Test goal');
      expect(state.subgoals).toEqual([]);
      expect(state.currentSubgoal).toBeNull();
      expect(state.permissions).toBe(2); // 默认权限为 2
      expect(state.iterationCount).toBe(0);
      expect(state.noProgressCount).toBe(0);
      expect(state.version).toBe(0);
      expect(state.custom).toEqual({});
    });

    it('createInitialState() 可以指定权限级别', () => {
      const state = createInitialState('Test goal', 4);
      expect(state.permissions).toBe(4);
    });
  });

  describe('canTransition()', () => {
    it("canTransition('plan', 'execute') 返回 true", () => {
      expect(canTransition('plan', 'execute')).toBe(true);
    });

    it("canTransition('plan', 'review') 返回 false", () => {
      expect(canTransition('plan', 'review')).toBe(false);
    });

    it("canTransition('recovery', 'execute') 返回 false", () => {
      expect(canTransition('recovery', 'execute')).toBe(false);
    });

    it("canTransition('execute', 'review') 返回 true", () => {
      expect(canTransition('execute', 'review')).toBe(true);
    });

    it("canTransition('execute', 'plan') 返回 true", () => {
      expect(canTransition('execute', 'plan')).toBe(true);
    });

    it("canTransition('review', 'execute') 返回 true", () => {
      expect(canTransition('review', 'execute')).toBe(true);
    });

    it("canTransition('review', 'plan') 返回 true", () => {
      expect(canTransition('review', 'plan')).toBe(true);
    });

    it("canTransition('recovery', 'plan') 返回 true", () => {
      expect(canTransition('recovery', 'plan')).toBe(true);
    });
  });

  describe('getValidTransitions()', () => {
    it('返回所有合法的切换目标', () => {
      expect(getValidTransitions('plan')).toEqual(['execute', 'recovery']);
      expect(getValidTransitions('execute')).toEqual(['review', 'recovery', 'plan']);
      expect(getValidTransitions('review')).toEqual(['execute', 'plan', 'recovery']);
      expect(getValidTransitions('recovery')).toEqual(['plan']);
    });
  });

  describe('Mode 状态机规则', () => {
    it('plan 只能切换到 execute 或 recovery', () => {
      const planModes: Mode[] = ['plan', 'execute', 'review', 'recovery'];
      
      for (const mode of planModes) {
        const result = canTransition('plan', mode);
        if (mode === 'execute' || mode === 'recovery') {
          expect(result).toBe(true);
        } else {
          expect(result).toBe(false);
        }
      }
    });

    it('execute 可以切换到 review、recovery 或 plan', () => {
      const executeModes: Mode[] = ['plan', 'execute', 'review', 'recovery'];
      
      for (const mode of executeModes) {
        const result = canTransition('execute', mode);
        if (mode === 'review' || mode === 'recovery' || mode === 'plan') {
          expect(result).toBe(true);
        } else {
          expect(result).toBe(false);
        }
      }
    });

    it('review 可以切换到 execute、plan 或 recovery', () => {
      const reviewModes: Mode[] = ['plan', 'execute', 'review', 'recovery'];
      
      for (const mode of reviewModes) {
        const result = canTransition('review', mode);
        if (mode === 'execute' || mode === 'plan' || mode === 'recovery') {
          expect(result).toBe(true);
        } else {
          expect(result).toBe(false);
        }
      }
    });

    it('recovery 只能切换到 plan', () => {
      const recoveryModes: Mode[] = ['plan', 'execute', 'review', 'recovery'];
      
      for (const mode of recoveryModes) {
        const result = canTransition('recovery', mode);
        if (mode === 'plan') {
          expect(result).toBe(true);
        } else {
          expect(result).toBe(false);
        }
      }
    });
  });

  describe('AgentState', () => {
    it('可以更新 version', () => {
      const state = createInitialState('Test');
      
      state.version = 1;
      expect(state.version).toBe(1);
      
      state.version = 2;
      expect(state.version).toBe(2);
    });

    it('可以存储自定义数据', () => {
      const state = createInitialState('Test');
      
      state.custom['key'] = 'value';
      state.custom['data'] = { nested: true };
      
      expect(state.custom['key']).toBe('value');
      expect((state.custom['data'] as any).nested).toBe(true);
    });

    it('可以更新 subgoals', () => {
      const state = createInitialState('Test');
      
      state.subgoals = ['subgoal1', 'subgoal2'];
      state.currentSubgoal = state.subgoals[0];
      
      expect(state.subgoals.length).toBe(2);
      expect(state.currentSubgoal).toBe('subgoal1');
    });
  });
});
