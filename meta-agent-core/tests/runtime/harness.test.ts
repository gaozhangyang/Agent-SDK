// tests/runtime/harness.test.ts

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { Harness } from '../../src/runtime/harness';
import { localPrimitives } from '../../src/core/primitives';
import { TerminalLog } from '../../src/core/trace';

describe('Harness', () => {
  let tempDir: string;
  let primitives: ReturnType<typeof localPrimitives>;
  let harness: Harness;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-test-'));
    
    // 初始化 git 仓库
    await fs.writeFile(path.join(tempDir, '.gitignore'), '.agent\n', 'utf-8');
    const { exec } = require('child_process');
    await new Promise<void>((resolve, reject) => {
      exec(`cd ${tempDir} && git init && git config user.email "test@test.com" && git config user.name "Test"`, 
        (err: any) => err ? reject(err) : resolve());
    });

    const terminalLog = new TerminalLog();
    primitives = localPrimitives(tempDir, terminalLog);
    harness = new Harness(primitives, tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('在真实 git 仓库中 snapshot() 返回 true', async () => {
    const result = await harness.snapshot('test-snapshot');
    expect(result).toBe(true);
  });

  test('snapshot() 创建 git commit', async () => {
    await harness.snapshot('initial');
    
    const log = await primitives.bash(`cd ${tempDir} && git log --oneline`);
    expect(log).toContain('initial');
  });

  test('rollback() 无历史时返回 false', async () => {
    const result = await harness.rollback();
    expect(result).toBe(false);
  });

  test('rollback() 回退到上一个快照', async () => {
    // 创建文件并快照
    await fs.writeFile(path.join(tempDir, 'file1.txt'), 'version 1', 'utf-8');
    await harness.snapshot('v1');
    
    // 修改文件并再次快照
    await fs.writeFile(path.join(tempDir, 'file1.txt'), 'version 2', 'utf-8');
    await harness.snapshot('v2');
    
    // 回滚
    const result = await harness.rollback();
    expect(result).toBe(true);
    
    // 验证文件内容已回滚
    const content = await fs.readFile(path.join(tempDir, 'file1.txt'), 'utf-8');
    expect(content).toBe('version 1');
  });

  test('getSnapshots() 返回快照历史', async () => {
    await harness.snapshot('snap1');
    await harness.snapshot('snap2');
    
    const snapshots = harness.getSnapshots();
    expect(snapshots).toHaveLength(2);
  });

  test('允许空快照（--allow-empty）', async () => {
    // 不修改任何文件
    const result = await harness.snapshot('empty');
    expect(result).toBe(true);
    
    const log = await primitives.bash(`cd ${tempDir} && git log --oneline`);
    expect(log).toContain('empty');
  });
});
