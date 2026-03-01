/**
 * harness.test.ts
 * 
 * 测试点：
 * - 在真实 git 仓库中 snapshot() 返回 true
 * - 在非 git 目录中 snapshot() 返回 false（不抛出）
 * - rollback() 无快照历史时返回 false（不抛出）
 */

import { Harness } from '../src/harness';
import { localPrimitives } from '../src/primitives';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

describe('Harness', () => {
  let tmpDir: string;
  let primitives: any;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-test-'));
    primitives = localPrimitives;
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('snapshot()', () => {
    it('在真实 git 仓库中 snapshot() 返回 true', async () => {
      // 初始化 git 仓库
      await execAsync('git init', { cwd: tmpDir });
      await execAsync('git config user.email "test@test.com"', { cwd: tmpDir });
      await execAsync('git config user.name "Test"', { cwd: tmpDir });

      // 创建初始提交
      await fs.writeFile(path.join(tmpDir, 'initial.txt'), 'initial content');
      await execAsync('git add -A', { cwd: tmpDir });
      await execAsync('git commit -m "initial"', { cwd: tmpDir });

      const harness = new Harness(primitives, tmpDir);
      const result = await harness.snapshot('test-snapshot');

      expect(result).toBe(true);
      expect(harness.getSnapshots().length).toBe(1);
    });

    it('在非 git 目录中 snapshot() 返回 false（不抛出）', async () => {
      // tmpDir 不是 git 仓库
      const harness = new Harness(primitives, tmpDir);
      
      const result = await harness.snapshot('test-snapshot');

      expect(result).toBe(false);
    });

    it('snapshot() 使用 --allow-empty 允许空提交', async () => {
      // 初始化 git 仓库
      await execAsync('git init', { cwd: tmpDir });
      await execAsync('git config user.email "test@test.com"', { cwd: tmpDir });
      await execAsync('git config user.name "Test"', { cwd: tmpDir });
      
      // 创建初始提交
      await fs.writeFile(path.join(tmpDir, 'initial.txt'), 'initial');
      await execAsync('git add -A', { cwd: tmpDir });
      await execAsync('git commit -m "initial"', { cwd: tmpDir });

      const harness = new Harness(primitives, tmpDir);
      
      // 再次 snapshot 但没有新文件更改（使用 --allow-empty）
      const result = await harness.snapshot('empty-snapshot');

      expect(result).toBe(true);
    });
  });

  describe('rollback()', () => {
    it("rollback() 无快照历史时返回 false（不抛出）", async () => {
      // 初始化 git 仓库
      await execAsync('git init', { cwd: tmpDir });
      await execAsync('git config user.email "test@test.com"', { cwd: tmpDir });
      await execAsync('git config user.name "Test"', { cwd: tmpDir });
      
      // 创建初始提交
      await fs.writeFile(path.join(tmpDir, 'initial.txt'), 'initial');
      await execAsync('git add -A', { cwd: tmpDir });
      await execAsync('git commit -m "initial"', { cwd: tmpDir });

      const harness = new Harness(primitives, tmpDir);
      
      // 没有快照历史时 rollback
      const result = await harness.rollback();

      expect(result).toBe(false);
    });

    it('rollback() 可以回退到之前的快照', async () => {
      // 初始化 git 仓库
      await execAsync('git init', { cwd: tmpDir });
      await execAsync('git config user.email "test@test.com"', { cwd: tmpDir });
      await execAsync('git config user.name "Test"', { cwd: tmpDir });
      
      // 创建初始提交
      await fs.writeFile(path.join(tmpDir, 'file.txt'), 'version 1');
      await execAsync('git add -A', { cwd: tmpDir });
      await execAsync('git commit -m "v1"', { cwd: tmpDir });

      const harness = new Harness(primitives, tmpDir);
      
      // 创建快照
      await harness.snapshot('snap1');
      
      // 修改文件
      await fs.writeFile(path.join(tmpDir, 'file.txt'), 'version 2');
      await harness.snapshot('snap2');
      
      // 确认文件是 version 2
      let content = await fs.readFile(path.join(tmpDir, 'file.txt'), 'utf-8');
      expect(content).toBe('version 2');
      
      // 回退
      const result = await harness.rollback();
      
      // 回退后应该是 version 1（上一个快照）
      content = await fs.readFile(path.join(tmpDir, 'file.txt'), 'utf-8');
      expect(content).toBe('version 1');
      expect(result).toBe(true);
    });
  });

  describe('isGitRepo()', () => {
    it('在 git 仓库中返回 true', async () => {
      await execAsync('git init', { cwd: tmpDir });
      
      const harness = new Harness(primitives, tmpDir);
      const result = await harness.isGitRepo();
      
      expect(result).toBe(true);
    });

    it('在非 git 目录中返回 false', async () => {
      const harness = new Harness(primitives, tmpDir);
      const result = await harness.isGitRepo();
      
      expect(result).toBe(false);
    });
  });
});
