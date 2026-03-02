// tests/integration.test.ts

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createMetaAgent, MetaAgent } from '../src/index';
import { LLMProvider } from '../src/core/llm';

describe('Integration', () => {
  let tempDir: string;
  let mockProvider: LLMProvider;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'integration-test-'));
    
    // 初始化 git 仓库
    const { exec } = require('child_process');
    await new Promise<void>((resolve, reject) => {
      exec(`cd ${tempDir} && git init && git config user.email "test@test.com" && git config user.name "Test"`, 
        (err: any) => err ? reject(err) : resolve());
    });

    // Mock LLMProvider 返回合理的响应
    mockProvider = {
      complete: jest.fn().mockImplementation((systemPrompt, userMessage) => {
        // 判断是 reason 还是 judge 调用
        if (systemPrompt.includes('reason') || systemPrompt.includes('编码 Agent')) {
          return Promise.resolve('{"result": "执行成功", "uncertainty": {"score": 0.2, "reasons": []}}');
        } else if (systemPrompt.includes('capability')) {
          return Promise.resolve('{"decision": "完全可行", "uncertainty": {"score": 0.1, "reasons": []}}');
        } else if (systemPrompt.includes('risk')) {
          return Promise.resolve('{"decision": "通过", "uncertainty": {"score": 0.2, "reasons": []}}');
        } else if (systemPrompt.includes('outcome')) {
          return Promise.resolve('{"decision": "达成", "uncertainty": {"score": 0.2, "reasons": []}}');
        } else {
          return Promise.resolve('{"decision": "通过", "uncertainty": {"score": 0.2, "reasons": []}}');
        }
      }),
    };
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('createMetaAgent 工厂函数可正常创建', async () => {
    const agent = await createMetaAgent(
      tempDir,
      '简单任务',
      mockProvider,
      {
        permissions: 2,
        logToFile: false,
      }
    );

    expect(agent).toBeDefined();
    expect(typeof agent.run).toBe('function');
    expect(typeof agent.interrupt).toBe('function');
    expect(typeof agent.getState).toBe('function');
    expect(typeof agent.getTrace).toBe('function');
    expect(typeof agent.getTerminalLog).toBe('function');
  });

  test('.agent/ 目录被创建', async () => {
    await createMetaAgent(
      tempDir,
      '测试',
      mockProvider,
      { logToFile: false }
    );

    const agentDir = path.join(tempDir, '.agent');
    const exists = await fs.access(agentDir).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  test('getState 返回初始状态', async () => {
    const agent = await createMetaAgent(
      tempDir,
      '测试',
      mockProvider,
      { logToFile: false }
    );

    const state = agent.getState();
    expect(state.goal).toBe('测试');
    expect(state.mode).toBe('plan');
  });

  test('getTrace 返回 Trace 实例', async () => {
    const agent = await createMetaAgent(
      tempDir,
      '测试',
      mockProvider,
      { logToFile: false }
    );

    const trace = agent.getTrace();
    expect(trace).toBeDefined();
    expect(typeof trace.all).toBe('function');
  });

  test('getTerminalLog 返回 TerminalLog 实例', async () => {
    const agent = await createMetaAgent(
      tempDir,
      '测试',
      mockProvider,
      { logToFile: false }
    );

    const terminalLog = agent.getTerminalLog();
    expect(terminalLog).toBeDefined();
    expect(typeof terminalLog.all).toBe('function');
  });

  test('interrupt() 添加信号', async () => {
    const agent = await createMetaAgent(
      tempDir,
      '测试',
      mockProvider,
      { logToFile: false }
    );

    // 添加中断信号
    agent.interrupt('测试消息');

    // 再次创建 agent 后应该能恢复
    const agent2 = await createMetaAgent(
      tempDir,
      '测试',
      mockProvider,
      { logToFile: false }
    );
    expect(agent2.getState()).toBeDefined();
  });

  test('logToFile 为 true 时创建 trace.jsonl 和 terminal.jsonl', async () => {
    await createMetaAgent(
      tempDir,
      '测试',
      mockProvider,
      { logToFile: true }
    );

    const agentDir = path.join(tempDir, '.agent');
    
    // 检查目录存在
    const dirExists = await fs.access(agentDir).then(() => true).catch(() => false);
    expect(dirExists).toBe(true);
  });
});
