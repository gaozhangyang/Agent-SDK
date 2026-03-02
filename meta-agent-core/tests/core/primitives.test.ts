// tests/core/primitives.test.ts

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { localPrimitives, Primitives } from '../../src/core/primitives';
import { TerminalLog } from '../../src/core/trace';

describe('Primitives', () => {
  let tempDir: string;
  let primitives: Primitives;
  let terminalLog: TerminalLog;
  let coreDir: string; // 使用不同的目录作为 coreDir

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'primitives-test-'));
    coreDir = await fs.mkdtemp(path.join(os.tmpdir(), 'core-dir-'));
    terminalLog = new TerminalLog();
    primitives = localPrimitives(coreDir, terminalLog);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.rm(coreDir, { recursive: true, force: true });
  });

  test('read() 读取临时文件内容正确', async () => {
    const testFile = path.join(tempDir, 'test.txt');
    await fs.writeFile(testFile, 'hello world', 'utf-8');
    
    const content = await primitives.read(testFile);
    expect(content).toBe('hello world');
  });

  test('write() 写入后 read() 可读回', async () => {
    const testFile = path.join(tempDir, 'output.txt');
    const content = 'test content\nmultiple lines';
    
    await primitives.write(testFile, content);
    const readContent = await primitives.read(testFile);
    
    expect(readContent).toBe(content);
  });

  test('edit() 唯一匹配时替换成功', async () => {
    const testFile = path.join(tempDir, 'edit-test.txt');
    await fs.writeFile(testFile, 'hello world', 'utf-8');
    
    await primitives.edit(testFile, 'world', 'there');
    
    const content = await fs.readFile(testFile, 'utf-8');
    expect(content).toBe('hello there');
  });

  test('edit() 多处匹配时抛出含 "found 2 times" 的错误', async () => {
    const testFile = path.join(tempDir, 'edit-multi.txt');
    await fs.writeFile(testFile, 'hello world world', 'utf-8');
    
    await expect(primitives.edit(testFile, 'world', 'there'))
      .rejects.toThrow('found 2 times');
  });

  test('bash() 执行 echo hello 返回含 hello 的字符串', async () => {
    const output = await primitives.bash('echo hello');
    expect(output).toContain('hello');
  });

  test('write() 写入 coreDir 下的路径时抛出错误', async () => {
    // 使用 tempDir 作为 coreDir，这样 tempDir 下的任何文件都会被拒绝
    const corePrimitives = localPrimitives(tempDir, terminalLog);
    
    // 尝试写入 tempDir 下的文件（应该被拒绝）
    const protectedFile = path.join(tempDir, 'protected.txt');
    
    await expect(corePrimitives.write(protectedFile, 'should fail'))
      .rejects.toThrow('cannot modify core directory');
  });

  test('bash() 执行后 TerminalLog 新增一条记录', async () => {
    await primitives.bash('echo test');
    
    const entries = terminalLog.all();
    expect(entries).toHaveLength(1);
    expect(entries[0].command).toBe('echo test');
    expect(entries[0].output).toContain('test');
  });

  test('edit() 编辑 coreDir 下的路径时抛出错误', async () => {
    const corePrimitives = localPrimitives(tempDir, terminalLog);
    
    const protectedFile = path.join(tempDir, 'protected.txt');
    await fs.writeFile(protectedFile, 'original', 'utf-8');
    
    await expect(corePrimitives.edit(protectedFile, 'original', 'modified'))
      .rejects.toThrow('cannot modify core directory');
  });

  test('read() 可以读取 coreDir 外的文件', async () => {
    const corePrimitives = localPrimitives(tempDir, terminalLog);
    
    // 读取 tempDir 外的文件应该可以
    const outsideFile = path.join(os.tmpdir(), 'outside-' + Date.now() + '.txt');
    await fs.writeFile(outsideFile, 'outside content', 'utf-8');
    
    const content = await corePrimitives.read(outsideFile);
    expect(content).toBe('outside content');
    
    await fs.unlink(outsideFile);
  });
});
