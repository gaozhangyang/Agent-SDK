// tests/core/trace.test.ts

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { Trace, TerminalLog, TraceEntry, TerminalEntry } from '../../src/core/trace';

describe('Trace', () => {
  let tempDir: string;
  let traceLogPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-test-'));
    traceLogPath = path.join(tempDir, 'trace.jsonl');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('append() 后 all() 长度正确，seq 自增', () => {
    const trace = new Trace();
    
    trace.append({ ts: 1000, kind: 'collect', data: {} });
    trace.append({ ts: 2000, kind: 'reason', data: {} });
    
    const entries = trace.all();
    expect(entries).toHaveLength(2);
    expect(entries[0].seq).toBe(1);
    expect(entries[1].seq).toBe(2);
  });

  test('filterByTag() 只返回含该 tag 的条目', () => {
    const trace = new Trace();
    
    trace.append({ ts: 1000, kind: 'collect', data: {}, tags: ['tag1'] });
    trace.append({ ts: 2000, kind: 'reason', data: {}, tags: ['tag2'] });
    trace.append({ ts: 3000, kind: 'judge', data: {}, tags: ['tag1', 'tag3'] });
    
    const filtered = trace.filterByTag('tag1');
    expect(filtered).toHaveLength(2);
    expect(filtered[0].seq).toBe(1);
    expect(filtered[1].seq).toBe(3);
  });

  test('serialize() 输出合法 JSON', () => {
    const trace = new Trace();
    trace.append({ ts: 1000, kind: 'collect', data: { key: 'value' } });
    
    const serialized = trace.serialize();
    expect(() => JSON.parse(serialized)).not.toThrow();
    
    const parsed = JSON.parse(serialized);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].data).toEqual({ key: 'value' });
  });

  test('提供 logFilePath 时追加写文件', async () => {
    const trace = new Trace(traceLogPath);
    
    trace.append({ ts: 1000, kind: 'collect', data: { test: 1 } });
    trace.append({ ts: 2000, kind: 'reason', data: { test: 2 } });
    
    // 等待异步写入完成
    await trace.flush();
    
    // 验证文件内容
    const content = await fs.readFile(traceLogPath, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
    
    const entry1 = JSON.parse(lines[0]);
    expect(entry1.kind).toBe('collect');
    expect(entry1.seq).toBe(1);
  });
});

describe('TerminalLog', () => {
  let tempDir: string;
  let terminalLogPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'terminal-test-'));
    terminalLogPath = path.join(tempDir, 'terminal.jsonl');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('append() 写入后 all() 可读回', () => {
    const terminalLog = new TerminalLog();
    
    terminalLog.append({
      ts: 1000,
      command: 'echo hello',
      stdout: 'hello\n',
      stderr: '',
      exitCode: 0,
      durationMs: 10,
    });
    
    const entries = terminalLog.all();
    expect(entries).toHaveLength(1);
    expect(entries[0].command).toBe('echo hello');
    expect(entries[0].seq).toBe(1);
  });

  test('Trace 和 TerminalLog 的 seq 各自独立自增', () => {
    const trace = new Trace();
    const terminalLog = new TerminalLog();
    
    trace.append({ ts: 1000, kind: 'collect', data: {} });
    terminalLog.append({ ts: 2000, command: 'ls', stdout: '', stderr: '', exitCode: 0, durationMs: 0 });
    trace.append({ ts: 3000, kind: 'reason', data: {} });
    terminalLog.append({ ts: 4000, command: 'pwd', stdout: '', stderr: '', exitCode: 0, durationMs: 0 });
    
    expect(trace.getSeq()).toBe(2);
    expect(terminalLog.getSeq()).toBe(2);
    
    // 验证两者的 seq 是独立的
    const traceEntries = trace.all();
    const terminalEntries = terminalLog.all();
    
    expect(traceEntries[0].seq).toBe(1);
    expect(traceEntries[1].seq).toBe(2);
    expect(terminalEntries[0].seq).toBe(1);
    expect(terminalEntries[1].seq).toBe(2);
  });

  test('提供 logFilePath 时追加写文件', async () => {
    const terminalLog = new TerminalLog(terminalLogPath);
    
    terminalLog.append({
      ts: 1000,
      command: 'echo test',
      stdout: 'test\n',
      stderr: '',
      exitCode: 0,
      durationMs: 5,
    });
    
    // 等待异步写入完成
    await terminalLog.flush();
    
    const content = await fs.readFile(terminalLogPath, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);
    
    const entry = JSON.parse(lines[0]);
    expect(entry.command).toBe('echo test');
    expect(entry.seq).toBe(1);
  });

  test('serialize() 输出合法 JSON', () => {
    const terminalLog = new TerminalLog();
    terminalLog.append({
      ts: 1000,
      command: 'ls -la',
      stdout: 'total 0\n',
      stderr: '',
      exitCode: 0,
      durationMs: 20,
    });
    
    const serialized = terminalLog.serialize();
    expect(() => JSON.parse(serialized)).not.toThrow();
    
    const parsed = JSON.parse(serialized);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].command).toBe('ls -la');
  });
});
