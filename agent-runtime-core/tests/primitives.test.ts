/**
 * primitives.test.ts
 * 
 * 测试点：
 * - read() 读取真实临时文件内容正确
 * - write() 写入后 read() 可读回
 * - edit() 唯一匹配时替换成功
 * - edit() 多处匹配时抛出错误（不能静默失败）
 * - bash() 执行 echo hello 返回 "hello\n"
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { localPrimitives } from '../src/primitives';

describe('primitives', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'primitives-test-'));
  });

  afterEach(async () => {
    // 清理临时目录
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('read()', () => {
    it('read() 读取真实临时文件内容正确', async () => {
      const testFile = path.join(tmpDir, 'test.txt');
      const content = 'Hello, World!';
      await fs.writeFile(testFile, content, 'utf-8');

      const result = await localPrimitives.read(testFile);
      expect(result).toBe(content);
    });

    it('read() 读取多行文件', async () => {
      const testFile = path.join(tmpDir, 'multi.txt');
      const content = 'Line 1\nLine 2\nLine 3';
      await fs.writeFile(testFile, content, 'utf-8');

      const result = await localPrimitives.read(testFile);
      expect(result).toBe(content);
    });

    it('read() 抛出错误当文件不存在', async () => {
      await expect(
        localPrimitives.read(path.join(tmpDir, 'nonexistent.txt'))
      ).rejects.toThrow();
    });
  });

  describe('write()', () => {
    it('write() 写入后 read() 可读回', async () => {
      const testFile = path.join(tmpDir, 'write-test.txt');
      const content = 'Test content';

      await localPrimitives.write(testFile, content);
      const result = await localPrimitives.read(testFile);
      
      expect(result).toBe(content);
    });

    it('write() 覆盖已有文件', async () => {
      const testFile = path.join(tmpDir, 'overwrite.txt');
      
      await localPrimitives.write(testFile, 'Original');
      await localPrimitives.write(testFile, 'Updated');
      
      const result = await localPrimitives.read(testFile);
      expect(result).toBe('Updated');
    });

    it('write() 创建嵌套目录中的文件', async () => {
      const nestedFile = path.join(tmpDir, 'nested', 'deep', 'file.txt');
      
      await localPrimitives.write(nestedFile, 'Nested content');
      
      const result = await localPrimitives.read(nestedFile);
      expect(result).toBe('Nested content');
    });
  });

  describe('edit()', () => {
    it('edit() 唯一匹配时替换成功', async () => {
      const testFile = path.join(tmpDir, 'edit-test.txt');
      const original = 'Hello World, Welcome!';
      await fs.writeFile(testFile, original, 'utf-8');

      await localPrimitives.edit(testFile, 'World', 'Universe');

      const result = await localPrimitives.read(testFile);
      expect(result).toBe('Hello Universe, Welcome!');
    });

    it('edit() 精确替换多处匹配时抛出错误', async () => {
      const testFile = path.join(tmpDir, 'edit-multi.txt');
      const original = 'foo bar foo baz foo';
      await fs.writeFile(testFile, original, 'utf-8');

      // 匹配 3 次，应该抛出错误
      await expect(
        localPrimitives.edit(testFile, 'foo', 'FOO')
      ).rejects.toThrow(/must match exactly once, found 3 times/);
    });

    it('edit() 不匹配时抛出错误', async () => {
      const testFile = path.join(tmpDir, 'edit-none.txt');
      const original = 'Hello World';
      await fs.writeFile(testFile, original, 'utf-8');

      await expect(
        localPrimitives.edit(testFile, 'NotExist', 'New')
      ).rejects.toThrow(/must match exactly once, found 0 times/);
    });

    it('edit() 精确单次匹配成功', async () => {
      const testFile = path.join(tmpDir, 'edit-once.txt');
      const original = 'foo bar baz';
      await fs.writeFile(testFile, original, 'utf-8');

      await localPrimitives.edit(testFile, 'bar', 'BAR');

      const result = await localPrimitives.read(testFile);
      expect(result).toBe('foo BAR baz');
    });
  });

  describe('bash()', () => {
    it('bash() 执行 echo hello 返回 "hello\\n"', async () => {
      const result = await localPrimitives.bash('echo hello');
      expect(result.trim()).toBe('hello');
    });

    it('bash() 执行 ls 命令', async () => {
      const result = await localPrimitives.bash(`ls ${tmpDir}`);
      // 应该能列出目录内容
      expect(result).toBeDefined();
    });

    it('bash() 执行带管道的命令', async () => {
      const result = await localPrimitives.bash('echo "test" | cat');
      expect(result.trim()).toBe('test');
    });

    it('bash() 执行不存在的命令抛出错误', async () => {
      await expect(
        localPrimitives.bash('nonexistent-command-xyz')
      ).rejects.toThrow();
    });
  });
});
