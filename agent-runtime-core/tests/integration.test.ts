/**
 * integration.test.ts
 * 
 * 测试点（使用 mock，完整跑通一次循环）：
 * - 从 plan 模式启动，经过 execute → review，最终 completed
 * - Trace 中包含 collect、reason、judge、exec、stop 类型条目
 * - State.version 在每次 mode 切换后递增
 */

import { runLoop } from '../src/loop';
import { LLMCall, type LLMProvider } from '../src/llm';
import { Trace } from '../src/trace';
import { Harness } from '../src/harness';
import { localPrimitives } from '../src/primitives';
import { createInitialState } from '../src/state';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

describe('runLoop Integration', () => {
  let tmpDir: string;
  let primitives: any;
  let mockProvider: jest.Mocked<LLMProvider>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'integration-test-'));
    
    // 初始化 git 仓库
    await execAsync('git init', { cwd: tmpDir });
    await execAsync('git config user.email "test@test.com"', { cwd: tmpDir });
    await execAsync('git config user.name "Test"', { cwd: tmpDir });
    await fs.writeFile(path.join(tmpDir, 'initial.txt'), 'initial');
    await execAsync('git add -A', { cwd: tmpDir });
    await execAsync('git commit -m "initial"', { cwd: tmpDir });
    
    primitives = localPrimitives;
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('从 plan 模式启动，经过 execute → review，最终 completed', async () => {
    // 模拟完整的成功流程：
    // 1. plan: reason 产生 proposal
    // 2. plan: judge(risk) 通过
    // 3. execute: snapshot + exec
    // 4. review: judge(outcome) 通过
    // 5. 完成
    
    let callCount = 0;
    mockProvider = {
      complete: jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // reason 返回
          return Promise.resolve('{"result": " proposal ", "uncertainty": {"score": 0.2, "reasons": []}}');
        } else if (callCount === 2) {
          // judge(risk) 返回通过
          return Promise.resolve('{"decision": "通过", "uncertainty": {"score": 0.1, "reasons": []}}');
        } else if (callCount === 3) {
          // judge(outcome) 返回达成
          return Promise.resolve('{"decision": "达成", "uncertainty": {"score": 0.1, "reasons": []}}');
        }
        return Promise.resolve('{"decision": "通过", "uncertainty": {"score": 0.1, "reasons": []}}');
      }),
    };
    
    const llm = new LLMCall(mockProvider);
    const trace = new Trace();
    const harness = new Harness(primitives, tmpDir);
    
    const state = createInitialState('Test goal', 2);
    state.currentSubgoal = 'test subgoal'; // 确保循环执行

    const result = await runLoop(state, {
      collectConfig: {
        sources: [{ type: 'file', query: path.join(tmpDir, 'initial.txt') }],
      },
      thresholds: {
        maxIterations: 50,
        confidenceLow: 0.1,
        confidenceMid: 0.5,
        uncertaintyHigh: 0.8,
        maxNoProgress: 3,
      },
    }, primitives, llm, trace, harness);

    // 验证流程完成
    expect(result.status).toBe('completed');
    
    // 验证 State 的 mode 转换
    // 初始: plan -> execute -> review -> plan (循环结束)
    expect(state.version).toBeGreaterThan(0); // 版本号应该递增
  });

  it('Trace 中包含 collect、reason、judge、exec、stop 类型条目', async () => {
    let callCount = 0;
    mockProvider = {
      complete: jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve('{"result": "proposal", "uncertainty": {"score": 0.2, "reasons": []}}');
        } else if (callCount === 2) {
          return Promise.resolve('{"decision": "通过", "uncertainty": {"score": 0.1, "reasons": []}}');
        } else {
          return Promise.resolve('{"decision": "达成", "uncertainty": {"score": 0.1, "reasons": []}}');
        }
      }),
    };
    
    const llm = new LLMCall(mockProvider);
    const trace = new Trace();
    const harness = new Harness(primitives, tmpDir);
    
    const state = createInitialState('Test goal', 2);
    state.currentSubgoal = 'test subgoal';

    await runLoop(state, {
      collectConfig: {
        sources: [{ type: 'file', query: path.join(tmpDir, 'initial.txt') }],
      },
      thresholds: {
        maxIterations: 50,
        confidenceLow: 0.1,
        confidenceMid: 0.5,
        uncertaintyHigh: 0.8,
        maxNoProgress: 3,
      },
    }, primitives, llm, trace, harness);

    const kinds = trace.all().map(e => e.kind);
    
    // 验证包含必要的类型
    expect(kinds).toContain('collect');
    expect(kinds).toContain('reason');
    expect(kinds).toContain('judge');
    expect(kinds).toContain('exec');
    expect(kinds).toContain('stop');
  });

  it('State.version 在每次 mode 切换后递增', async () => {
    let callCount = 0;
    mockProvider = {
      complete: jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve('{"result": "proposal", "uncertainty": {"score": 0.2, "reasons": []}}');
        } else if (callCount === 2) {
          return Promise.resolve('{"decision": "通过", "uncertainty": {"score": 0.1, "reasons": []}}');
        } else {
          return Promise.resolve('{"decision": "达成", "uncertainty": {"score": 0.1, "reasons": []}}');
        }
      }),
    };
    
    const llm = new LLMCall(mockProvider);
    const trace = new Trace();
    const harness = new Harness(primitives, tmpDir);
    
    const state = createInitialState('Test goal', 2);
    state.currentSubgoal = 'test subgoal';
    const initialVersion = state.version;

    await runLoop(state, {
      collectConfig: {
        sources: [{ type: 'file', query: path.join(tmpDir, 'initial.txt') }],
      },
      thresholds: {
        maxIterations: 50,
        confidenceLow: 0.1,
        confidenceMid: 0.5,
        uncertaintyHigh: 0.8,
        maxNoProgress: 3,
      },
    }, primitives, llm, trace, harness);

    // version 应该增加（至少一次 mode 切换）
    expect(state.version).toBeGreaterThan(initialVersion);
  });

  it('使用 subgoals 完整流程', async () => {
    let callCount = 0;
    mockProvider = {
      complete: jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve('{"result": "proposal1", "uncertainty": {"score": 0.2, "reasons": []}}');
        } else if (callCount === 2) {
          return Promise.resolve('{"decision": "通过", "uncertainty": {"score": 0.1, "reasons": []}}');
        } else if (callCount === 3) {
          return Promise.resolve('{"decision": "达成", "uncertainty": {"score": 0.1, "reasons": []}}');
        } else if (callCount === 4) {
          return Promise.resolve('{"result": "proposal2", "uncertainty": {"score": 0.2, "reasons": []}}');
        } else if (callCount === 5) {
          return Promise.resolve('{"decision": "通过", "uncertainty": {"score": 0.1, "reasons": []}}');
        } else {
          return Promise.resolve('{"decision": "达成", "uncertainty": {"score": 0.1, "reasons": []}}');
        }
      }),
    };
    
    const llm = new LLMCall(mockProvider);
    const trace = new Trace();
    const harness = new Harness(primitives, tmpDir);
    
    const state = createInitialState('Test goal', 2);
    state.subgoals = ['subgoal1', 'subgoal2'];
    state.currentSubgoal = 'subgoal1';

    await runLoop(state, {
      collectConfig: {
        sources: [{ type: 'file', query: path.join(tmpDir, 'initial.txt') }],
      },
      thresholds: {
        maxIterations: 50,
        confidenceLow: 0.1,
        confidenceMid: 0.5,
        uncertaintyHigh: 0.8,
        maxNoProgress: 3,
      },
    }, primitives, llm, trace, harness);

    // 应该有多个 reason 和 judge 调用
    expect(callCount).toBeGreaterThan(3);
    
    // 验证 version 多次增加
    expect(state.version).toBeGreaterThan(2);
  });
});
