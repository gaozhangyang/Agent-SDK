// tests/runtime/state.test.ts

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { StateManager, canTransition, createInitialState, AgentState, Mode, PermissionLevel, ArchivedSubgoal } from '../../src/runtime/state';

describe('State', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'state-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('createInitial() 默认 mode 为 plan，archivedSubgoals 为空数组', () => {
    const state = createInitialState('test goal');
    
    expect(state.mode).toBe('plan');
    expect(state.archivedSubgoals).toEqual([]);
    expect(state.goal).toBe('test goal');
    expect(state.permissions).toBe(2);
    expect(state.version).toBe(0);
  });

  test('canTransition(plan, execute) 返回 true', () => {
    expect(canTransition('plan', 'execute')).toBe(true);
  });

  test('canTransition(plan, review) 返回 false', () => {
    expect(canTransition('plan', 'review')).toBe(false);
  });

  test('任意 mode → paused 返回 true（v2 新增）', () => {
    expect(canTransition('plan', 'paused')).toBe(true);
    expect(canTransition('execute', 'paused')).toBe(true);
    expect(canTransition('review', 'paused')).toBe(true);
    expect(canTransition('recovery', 'paused')).toBe(true);
  });

  test('StateManager.save() 后 load() 可恢复相同 State', async () => {
    const stateManager = new StateManager();
    
    const originalState: AgentState = {
      sessionId: 'test-session-123',
      goal: 'test goal',
      subgoals: ['sub1', 'sub2'],
      currentSubgoal: 'sub1',
      currentSubgoal_src: 'T#1',
      archivedSubgoals: [],
      completedToolCalls: [],
      mode: 'execute',
      permissions: 3,
      iterationCount: 5,
      noProgressCount: 1,
      version: 10,
      custom: { key: 'value' },
    };

    await stateManager.save(tempDir, originalState);
    const loadedState = await stateManager.load(tempDir);

    expect(loadedState).not.toBeNull();
    expect(loadedState!.goal).toBe('test goal');
    expect(loadedState!.subgoals).toEqual(['sub1', 'sub2']);
    expect(loadedState!.mode).toBe('execute');
    expect(loadedState!.permissions).toBe(3);
    expect(loadedState!.version).toBe(10);
    expect(loadedState!.custom).toEqual({ key: 'value' });
  });

  test('StateManager.load() 文件不存在时返回 null', async () => {
    const stateManager = new StateManager();
    const result = await stateManager.load(tempDir);
    expect(result).toBeNull();
  });

  test('StateManager.load() JSON 解析失败返回 null', async () => {
    const stateManager = new StateManager();
    await fs.writeFile(path.join(tempDir, 'state.json'), 'invalid json', 'utf-8');
    
    const result = await stateManager.load(tempDir);
    expect(result).toBeNull();
  });

  test('createInitial 使用自定义 permissions', () => {
    const state = createInitialState('goal', 4);
    expect(state.permissions).toBe(4);
  });

  test('archivedSubgoals 在 State 中正确存储（v2 新数据结构）', () => {
    const state = createInitialState('goal');
    
    // 添加已完成子目标
    const archived1: ArchivedSubgoal = {
      goal: 'subgoal 1',
      summary: '成功完成任务1',
      outcome: 'completed',
    };
    const archived2: ArchivedSubgoal = {
      goal: 'subgoal 2',
      summary: '此路不通，已回滚',
      outcome: 'voided',
    };
    
    state.archivedSubgoals.push(archived1);
    state.archivedSubgoals.push(archived2);
    
    expect(state.archivedSubgoals).toHaveLength(2);
    expect(state.archivedSubgoals[0].goal).toBe('subgoal 1');
    expect(state.archivedSubgoals[0].outcome).toBe('completed');
    expect(state.archivedSubgoals[1].outcome).toBe('voided');
  });

  test('ArchivedSubgoal 类型包含 goal, summary, outcome', () => {
    const archived: ArchivedSubgoal = {
      goal: 'test goal',
      summary: 'test summary',
      outcome: 'completed',
    };
    
    expect(archived.goal).toBe('test goal');
    expect(archived.summary).toBe('test summary');
    expect(archived.outcome).toBe('completed');
  });
});
