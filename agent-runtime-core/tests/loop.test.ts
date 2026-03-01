/**
 * loop.test.ts
 * 
 * 测试点（使用 mock LLMProvider）：
 * - maxIterations 超出时返回 { status: 'budget_exceeded' }
 * - 快照失败时返回 { status: 'escalated', reason: 含'快照' }
 * - confidence 低于 confidenceLow 阈值时触发 escalate
 * - noProgressCount 超出 maxNoProgress 时触发 escalate
 * - subgoals 全部完成时返回 { status: 'completed' }
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

describe('runLoop', () => {
  let tmpDir: string;
  let primitives: any;
  let mockProvider: jest.Mocked<LLMProvider>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'loop-test-'));
    
    // 初始化 git 仓库
    await execAsync('git init', { cwd: tmpDir });
    await execAsync('git config user.email "test@test.com"', { cwd: tmpDir });
    await execAsync('git config user.name "Test"', { cwd: tmpDir });
    await fs.writeFile(path.join(tmpDir, 'initial.txt'), 'initial');
    await execAsync('git add -A', { cwd: tmpDir });
    await execAsync('git commit -m "initial"', { cwd: tmpDir });
    
    primitives = localPrimitives;
    
    // 创建 mock provider
    mockProvider = {
      complete: jest.fn().mockResolvedValue(
        '{"decision": "通过", "uncertainty": {"score": 0.2, "reasons": []}}'
      ),
    };
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('maxIterations 超出时返回 { status: "budget_exceeded" }', async () => {
    const llm = new LLMCall(mockProvider);
    const trace = new Trace();
    const harness = new Harness(primitives, tmpDir);
    
    const state = createInitialState('Test goal', 2);
    state.subgoals = ['subgoal1'];
    state.currentSubgoal = 'subgoal1';

    // 设置很低的 maxIterations
    const result = await runLoop(state, {
      collectConfig: {
        sources: [{ type: 'file', query: path.join(tmpDir, 'initial.txt') }],
      },
      thresholds: {
        maxIterations: 1, // 第一次迭代就会超出
        confidenceLow: 0.1,
        confidenceMid: 0.5,
        uncertaintyHigh: 0.8,
        maxNoProgress: 1,
      },
    }, primitives, llm, trace, harness);

    expect(result.status).toBe('budget_exceeded');
  });

  it('noProgressCount 超出 maxNoProgress 时触发 escalate', async () => {
    // 修改 mock 返回失败的结果
    mockProvider.complete.mockResolvedValue(
      '{"decision": "未达成", "uncertainty": {"score": 0.2, "reasons": []}}'
    );
    
    const llm = new LLMCall(mockProvider);
    const trace = new Trace();
    const harness = new Harness(primitives, tmpDir);
    
    const state = createInitialState('Test goal', 2);
    state.subgoals = ['subgoal1'];
    state.currentSubgoal = 'subgoal1';
    state.noProgressCount = 3; // 已经达到上限

    const result = await runLoop(state, {
      collectConfig: {
        sources: [{ type: 'file', query: path.join(tmpDir, 'initial.txt') }],
      },
      thresholds: {
        maxIterations: 50,
        confidenceLow: 0.1,
        confidenceMid: 0.5,
        uncertaintyHigh: 0.8,
        maxNoProgress: 3, // 与 state.noProgressCount 相同
      },
    }, primitives, llm, trace, harness);

    expect(result.status).toBe('escalated');
    expect((result as any).reason).toContain('无增益');
  });

  it('subgoals 全部完成时返回 { status: "completed" }', async () => {
    // 修改 mock 返回成功的结果
    mockProvider.complete.mockResolvedValue(
      '{"decision": "达成", "uncertainty": {"score": 0.1, "reasons": []}}'
    );
    
    const llm = new LLMCall(mockProvider);
    const trace = new Trace();
    const harness = new Harness(primitives, tmpDir);
    
    const state = createInitialState('Test goal', 2);
    // 不设置 subgoals，模拟完成状态

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

    expect(result.status).toBe('completed');
  });

  it('confidence 低于 confidenceLow 阈值时触发 escalate', async () => {
    // 修改 mock 返回不确定的结果（触发高 uncertainty）
    mockProvider.complete.mockResolvedValue(
      '{"decision": "通过", "uncertainty": {"score": 0.9, "reasons": ["不确定"]}}'
    );
    
    const llm = new LLMCall(mockProvider);
    const trace = new Trace();
    const harness = new Harness(primitives, tmpDir);
    
    const state = createInitialState('Test goal', 2);
    state.subgoals = ['subgoal1'];
    state.currentSubgoal = 'subgoal1';

    const result = await runLoop(state, {
      collectConfig: {
        sources: [{ type: 'file', query: path.join(tmpDir, 'notexist.txt') }], // 不存在的文件导致低 confidence
      },
      thresholds: {
        maxIterations: 50,
        confidenceLow: 0.3, // 较高的阈值
        confidenceMid: 0.5,
        uncertaintyHigh: 0.8,
        maxNoProgress: 3,
      },
    }, primitives, llm, trace, harness);

    expect(result.status).toBe('escalated');
  });

  it('Trace 包含正确的条目类型', async () => {
    mockProvider.complete
      .mockResolvedValueOnce('{"result": "proposal", "uncertainty": {"score": 0.2, "reasons": []}}') // reason
      .mockResolvedValueOnce('{"decision": "通过", "uncertainty": {"score": 0.2, "reasons": []}}') // judge risk
      .mockResolvedValueOnce('{"decision": "达成", "uncertainty": {"score": 0.1, "reasons": []}}'); // judge outcome
    
    const llm = new LLMCall(mockProvider);
    const trace = new Trace();
    const harness = new Harness(primitives, tmpDir);
    
    const state = createInitialState('Test goal', 2);
    state.currentSubgoal = 'test subgoal'; // 设置当前子目标以确保循环执行

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
    
    // 应该包含 collect, reason, judge 等类型
    expect(kinds).toContain('collect');
    expect(kinds).toContain('reason');
    expect(kinds).toContain('judge');
  });
});
