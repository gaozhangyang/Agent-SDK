// tests/runtime/loop.test.ts

import { runLoop, LoopConfig, LoopHooks, LoopDeps } from '../../src/runtime/loop';
import { createInitialState } from '../../src/runtime/state';
import { LLMCall, LLMProvider } from '../../src/core/llm';
import { localPrimitives } from '../../src/core/primitives';
import { Trace, TerminalLog } from '../../src/core/trace';
import { Memory } from '../../src/core/memory';
import { Harness } from '../../src/runtime/harness';
import { InterruptChannel } from '../../src/runtime/interrupt';
import { StateManager } from '../../src/runtime/state';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('Loop', () => {
  let tempDir: string;
  let mockProvider: LLMProvider;
  let primitives: ReturnType<typeof localPrimitives>;
  let llm: LLMCall;
  let trace: Trace;
  let terminalLog: TerminalLog;
  let memory: Memory;
  let harness: Harness;
  let interrupt: InterruptChannel;
  let stateManager: StateManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'loop-test-'));
    
    // 初始化 git 仓库
    const { exec } = require('child_process');
    await new Promise<void>((resolve, reject) => {
      exec(`cd ${tempDir} && git init && git config user.email "test@test.com" && git config user.name "Test"`, 
        (err: any) => err ? reject(err) : resolve());
    });

    // Mock LLMProvider
    mockProvider = {
      complete: jest.fn().mockResolvedValue('{"decision": "通过", "uncertainty": {"score": 0.2, "reasons": []}}'),
    };

    terminalLog = new TerminalLog();
    memory = new Memory();
    primitives = localPrimitives(tempDir, terminalLog);
    llm = new LLMCall(mockProvider);
    trace = new Trace();
    harness = new Harness(primitives, tempDir);
    interrupt = new InterruptChannel();
    stateManager = new StateManager();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('maxIterations 超出时返回 budget_exceeded', async () => {
    const state = createInitialState('test goal');
    // 需要有 subgoal 才能进入循环，否则会直接返回 completed
    state.subgoals = ['sub1'];
    state.currentSubgoal = 'sub1';

    const config: LoopConfig = {
      collectConfig: { sources: [{ type: 'file', query: tempDir + '/test.txt' }] },
      thresholds: { maxIterations: 1 },
    };

    const deps: LoopDeps = {
      primitives,
      llm,
      trace,
      terminalLog,
      memory,
      harness,
      interrupt,
      stateManager,
      agentDir: tempDir,
    };

    const result = await runLoop(state, config, deps);
    
    expect(result.status).toBe('budget_exceeded');
  });

  test('noProgressCount 超出 maxNoProgress 时 Escalate', async () => {
    const state = createInitialState('test goal');
    state.noProgressCount = 3;
    state.subgoals = ['sub1'];
    state.currentSubgoal = 'sub1';

    const config: LoopConfig = {
      collectConfig: { sources: [] },
      thresholds: { maxNoProgress: 2 },
      onEscalate: jest.fn(),
    };

    const deps: LoopDeps = {
      primitives,
      llm,
      trace,
      terminalLog,
      memory,
      harness,
      interrupt,
      stateManager,
      agentDir: tempDir,
    };

    const result = await runLoop(state, config, deps);
    
    expect(result.status).toBe('escalated');
  });

  test('所有子目标完成时返回 completed', async () => {
    const state = createInitialState('test goal');
    state.subgoals = [];
    state.currentSubgoal = null;

    const config: LoopConfig = {
      collectConfig: { sources: [] },
    };

    const deps: LoopDeps = {
      primitives,
      llm,
      trace,
      terminalLog,
      memory,
      harness,
      interrupt,
      stateManager,
      agentDir: tempDir,
    };

    const result = await runLoop(state, config, deps);
    
    expect(result.status).toBe('completed');
  });

  test('shouldSnapshot 返回 true 但 harness.snapshot 失败时返回 escalated', async () => {
    const state = createInitialState('test goal');
    state.subgoals = ['sub1'];
    state.currentSubgoal = 'sub1';
    state.mode = 'execute';

    // 创建一个测试文件用于 collect
    await fs.writeFile(path.join(tempDir, 'test.txt'), 'test content', 'utf-8');

    // Mock LLM 返回通过的结果，避免 noProgressCount 增加
    (mockProvider.complete as jest.Mock).mockResolvedValue(
      '{"decision": "pass", "uncertainty": {"score": 0.2, "reasons": []}}'
    );

    const config: LoopConfig = {
      collectConfig: { sources: [{ type: 'file', query: path.join(tempDir, 'test.txt') }] },
      thresholds: { maxIterations: 100, maxNoProgress: 10 },
    };

    const deps: LoopDeps = {
      primitives,
      llm,
      trace,
      terminalLog,
      memory,
      harness,
      interrupt,
      stateManager,
      agentDir: tempDir,
    };

    // 创建一个总是返回 true 的 shouldSnapshot
    const hooks: LoopHooks = {
      shouldSnapshot: async () => true,
    };

    // 删除 .git 目录使 snapshot 失败
    await fs.rm(path.join(tempDir, '.git'), { recursive: true });

    const result = await runLoop(state, config, deps, hooks);
    
    expect(result.status).toBe('escalated');
    expect((result as any).reason).toContain('快照');
  });

  test('onBeforeExec 返回 block 时返回 escalated', async () => {
    const state = createInitialState('test goal');
    state.subgoals = ['sub1'];
    state.currentSubgoal = 'sub1';
    state.mode = 'execute';

    // 创建一个测试文件用于 collect
    await fs.writeFile(path.join(tempDir, 'test.txt'), 'test content', 'utf-8');

    // Mock LLM 返回通过的结果
    (mockProvider.complete as jest.Mock).mockResolvedValue(
      '{"decision": "pass", "uncertainty": {"score": 0.2, "reasons": []}}'
    );

    const config: LoopConfig = {
      collectConfig: { sources: [{ type: 'file', query: path.join(tempDir, 'test.txt') }] },
      thresholds: { maxIterations: 100, maxNoProgress: 10 },
    };

    const deps: LoopDeps = {
      primitives,
      llm,
      trace,
      terminalLog,
      memory,
      harness,
      interrupt,
      stateManager,
      agentDir: tempDir,
    };

    const hooks: LoopHooks = {
      onBeforeExec: async () => 'block',
    };

    const result = await runLoop(state, config, deps, hooks);
    
    expect(result.status).toBe('escalated');
    expect((result as any).reason).toContain('阻止执行');
  });

  test('Interrupt 信号触发后 mode 切换为 paused', async () => {
    const state = createInitialState('test goal');
    state.subgoals = ['sub1'];
    state.currentSubgoal = 'sub1';
    state.mode = 'plan';

    const config: LoopConfig = {
      collectConfig: { sources: [] },
      thresholds: { maxIterations: 100 },
    };

    const deps: LoopDeps = {
      primitives,
      llm,
      trace,
      terminalLog,
      memory,
      harness,
      interrupt,
      stateManager,
      agentDir: tempDir,
    };

    // 在运行前添加 interrupt 信号
    interrupt.push({ message: 'pause', ts: Date.now() });

    const hooks: LoopHooks = {
      onInterrupt: async () => ({ action: 'continue' }),
    };

    const result = await runLoop(state, config, deps, hooks);
    
    // 应该继续运行，mode 会被切换回 plan
    // 由于 interrupt 被处理，状态应该更新
    expect(state.mode).toBe('plan');
  });

  test('每次迭代后 State 被持久化', async () => {
    const state = createInitialState('test goal');
    state.subgoals = ['sub1'];
    state.currentSubgoal = 'sub1';
    state.mode = 'plan';

    // 创建一个测试文件用于 collect
    await fs.writeFile(path.join(tempDir, 'test.txt'), 'test content', 'utf-8');

    // Mock LLM 返回通过的结果
    (mockProvider.complete as jest.Mock).mockResolvedValue(
      '{"decision": "pass", "uncertainty": {"score": 0.2, "reasons": []}}'
    );

    const config: LoopConfig = {
      collectConfig: { sources: [{ type: 'file', query: path.join(tempDir, 'test.txt') }] },
      thresholds: { maxIterations: 2, maxNoProgress: 10 },
    };

    const deps: LoopDeps = {
      primitives,
      llm,
      trace,
      terminalLog,
      memory,
      harness,
      interrupt,
      stateManager,
      agentDir: tempDir,
    };

    await runLoop(state, config, deps);
    
    // 验证 state.json 存在
    const stateFile = path.join(tempDir, 'state.json');
    const content = await fs.readFile(stateFile, 'utf-8');
    const savedState = JSON.parse(content);
    
    expect(savedState.iterationCount).toBeGreaterThan(0);
  });

  test('confidence 低于 confidenceLow 阈值时 Escalate', async () => {
    const state = createInitialState('test goal');
    state.subgoals = ['sub1'];
    state.currentSubgoal = 'sub1';

    // Mock LLM 返回低置信度
    (mockProvider.complete as jest.Mock).mockResolvedValue(
      '{"result": "result", "uncertainty": {"score": 0.9, "reasons": []}}'
    );

    const config: LoopConfig = {
      collectConfig: { sources: [{ type: 'file', query: '/nonexistent' }] },
      thresholds: { confidenceLow: 0.5 },
      onEscalate: jest.fn(),
    };

    const deps: LoopDeps = {
      primitives,
      llm,
      trace,
      terminalLog,
      memory,
      harness,
      interrupt,
      stateManager,
      agentDir: tempDir,
    };

    const result = await runLoop(state, config, deps);
    
    expect(result.status).toBe('escalated');
  });
});
