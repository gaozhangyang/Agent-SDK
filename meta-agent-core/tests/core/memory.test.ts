// tests/core/memory.test.ts

import { Memory } from '../../src/core/memory';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('Memory', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('append 后 all() 返回包含新条目的数组', () => {
    const memory = new Memory();
    
    memory.append({
      userRequest: '修复 bug',
      solutionSummary: '修改了第10行',
    });

    const entries = memory.all();
    expect(entries).toHaveLength(1);
    expect(entries[0].userRequest).toBe('修复 bug');
    expect(entries[0].solutionSummary).toBe('修改了第10行');
    expect(entries[0].ts).toBeDefined();
  });

  test('append 后 size() 返回正确数量', () => {
    const memory = new Memory();
    
    memory.append({ userRequest: 'task1', solutionSummary: 'sol1' });
    memory.append({ userRequest: 'task2', solutionSummary: 'sol2' });

    expect(memory.size()).toBe(2);
  });

  test('search 根据关键词检索记忆', () => {
    const memory = new Memory();
    
    memory.append({ userRequest: '修复数组越界', solutionSummary: '修改了循环边界' });
    memory.append({ userRequest: '优化性能', solutionSummary: '添加了缓存' });

    const results = memory.search('数组');
    expect(results).toHaveLength(1);
    expect(results[0].userRequest).toBe('修复数组越界');
  });

  test('recent 返回最近的 N 条记忆', () => {
    const memory = new Memory();
    
    for (let i = 1; i <= 5; i++) {
      memory.append({ userRequest: `task${i}`, solutionSummary: `sol${i}` });
    }

    const recent = memory.recent(3);
    expect(recent).toHaveLength(3);
    expect(recent[0].userRequest).toBe('task3');
    expect(recent[2].userRequest).toBe('task5');
  });

  test('serialize 输出合法 JSON', () => {
    const memory = new Memory();
    
    memory.append({ userRequest: 'task', solutionSummary: 'sol' });

    const json = memory.serialize();
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].userRequest).toBe('task');
  });

  test('提供 logFilePath 时追加写入文件', async () => {
    const logPath = path.join(tempDir, 'memory.jsonl');
    const memory = new Memory(logPath);
    
    memory.append({ userRequest: 'task1', solutionSummary: 'sol1' });
    await memory.flush(); // 等待写入完成

    // 读取文件验证
    const content = await fs.readFile(logPath, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);
    
    const entry = JSON.parse(lines[0]);
    expect(entry.userRequest).toBe('task1');
    expect(entry.solutionSummary).toBe('sol1');
  });

  test('多次 append 追加写入文件', async () => {
    const logPath = path.join(tempDir, 'memory.jsonl');
    const memory = new Memory(logPath);
    
    memory.append({ userRequest: 'task1', solutionSummary: 'sol1' });
    memory.append({ userRequest: 'task2', solutionSummary: 'sol2' });
    await memory.flush();

    const content = await fs.readFile(logPath, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
  });

  test('写入时自动创建目录', async () => {
    const logPath = path.join(tempDir, 'subdir', 'memory.jsonl');
    const memory = new Memory(logPath);
    
    memory.append({ userRequest: 'task', solutionSummary: 'sol' });
    await memory.flush();

    const content = await fs.readFile(logPath, 'utf-8');
    expect(content).toContain('task');
  });

  test('archivedSubgoal 字段正确保存', () => {
    const memory = new Memory();
    
    memory.append({ 
      userRequest: '修复bug', 
      solutionSummary: '修改代码',
      archivedSubgoal: '修复数组越界',
    });

    const entries = memory.all();
    expect(entries[0].archivedSubgoal).toBe('修复数组越界');
  });
});
