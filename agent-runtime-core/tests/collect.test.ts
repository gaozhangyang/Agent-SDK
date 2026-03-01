/**
 * collect.test.ts
 * 
 * 测试点：
 * - coverage = 成功来源数 / 总来源数
 * - 来源读取失败时该来源进入 gaps，by_source 中该 key 为 0
 * - maxTokens 生效时 context 长度不超过 maxTokens * 4 字符
 */

import { collect, type CollectConfig } from '../src/collect';
import { localPrimitives, type Primitives } from '../src/primitives';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('collect', () => {
  let tmpDir: string;
  let primitives: Primitives;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'collect-test-'));
    primitives = localPrimitives;
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('coverage 计算', () => {
    it('coverage = 成功来源数 / 总来源数', async () => {
      const file1 = path.join(tmpDir, 'file1.txt');
      const file2 = path.join(tmpDir, 'file2.txt');
      
      await fs.writeFile(file1, 'Content 1');
      await fs.writeFile(file2, 'Content 2');

      const config: CollectConfig = {
        sources: [
          { type: 'file', query: file1 },
          { type: 'file', query: file2 },
        ],
      };

      const result = await collect(config, primitives);

      // 2 个来源都成功，coverage = 2/2 = 1
      expect(result.confidence.coverage).toBe(1);
    });

    it('部分来源失败时 coverage 正确计算', async () => {
      const file1 = path.join(tmpDir, 'exist.txt');
      const file2 = path.join(tmpDir, 'notexist.txt');
      
      await fs.writeFile(file1, 'Content');

      const config: CollectConfig = {
        sources: [
          { type: 'file', query: file1 },
          { type: 'file', query: file2 },
        ],
      };

      const result = await collect(config, primitives);

      // 1 成功，1 失败，coverage = 1/2 = 0.5
      expect(result.confidence.coverage).toBe(0.5);
    });
  });

  describe('gaps 和 by_source', () => {
    it('来源读取失败时该来源进入 gaps', async () => {
      const file1 = path.join(tmpDir, 'exist.txt');
      const file2 = path.join(tmpDir, 'notexist.txt');
      
      await fs.writeFile(file1, 'Content');

      const config: CollectConfig = {
        sources: [
          { type: 'file', query: file1 },
          { type: 'file', query: file2 },
        ],
      };

      const result = await collect(config, primitives);

      expect(result.confidence.gaps).toContain(file2);
    });

    it('by_source 中失败来源的值为 0', async () => {
      const file1 = path.join(tmpDir, 'exist.txt');
      const file2 = path.join(tmpDir, 'notexist.txt');
      
      await fs.writeFile(file1, 'Content');

      const config: CollectConfig = {
        sources: [
          { type: 'file', query: file1 },
          { type: 'file', query: file2 },
        ],
      };

      const result = await collect(config, primitives);

      expect(result.confidence.by_source[file1]).toBe(1);
      expect(result.confidence.by_source[file2]).toBe(0);
    });

    it('成功来源的 by_source 值为权重值', async () => {
      const file1 = path.join(tmpDir, 'weighted.txt');
      await fs.writeFile(file1, 'Content');

      const config: CollectConfig = {
        sources: [
          { type: 'file', query: file1, weight: 0.8 },
        ],
      };

      const result = await collect(config, primitives);

      expect(result.confidence.by_source[file1]).toBe(0.8);
    });
  });

  describe('maxTokens 限制', () => {
    it('maxTokens 生效时 context 长度不超过 maxTokens * 4 字符', async () => {
      const file1 = path.join(tmpDir, 'large.txt');
      // 写入大量内容
      const largeContent = 'x'.repeat(20000);
      await fs.writeFile(file1, largeContent);

      const config: CollectConfig = {
        sources: [
          { type: 'file', query: file1 },
        ],
        maxTokens: 1000, // 1000 * 4 = 4000 字符
      };

      const result = await collect(config, primitives);

      // context 应该被截断到 maxTokens * 4
      expect(result.context.length).toBeLessThanOrEqual(4000 + 50); // 加上截断提示的长度
      expect(result.context).toContain('[... 已截断');
    });

    it('内容小于 maxTokens * 4 时不截断', async () => {
      const file1 = path.join(tmpDir, 'small.txt');
      const smallContent = 'Hello World';
      await fs.writeFile(file1, smallContent);

      const config: CollectConfig = {
        sources: [
          { type: 'file', query: file1 },
        ],
        maxTokens: 1000,
      };

      const result = await collect(config, primitives);

      expect(result.context).toContain(smallContent);
      expect(result.context).not.toContain('[... 已截断');
    });
  });

  describe('filters', () => {
    it('filters 过滤不包含关键词的来源', async () => {
      const file1 = path.join(tmpDir, 'match.txt');
      const file2 = path.join(tmpDir, 'nomatch.txt');
      
      await fs.writeFile(file1, 'Hello World');
      await fs.writeFile(file2, 'Foo Bar');

      const config: CollectConfig = {
        sources: [
          { type: 'file', query: file1 },
          { type: 'file', query: file2 },
        ],
        filters: ['Hello'],
      };

      const result = await collect(config, primitives);

      expect(result.context).toContain('Hello World');
      expect(result.context).not.toContain('Foo Bar');
      expect(result.confidence.gaps).toContain(file2);
    });
  });

  describe('bash 来源', () => {
    it('支持 bash 类型来源', async () => {
      const config: CollectConfig = {
        sources: [
          { type: 'bash', query: 'echo "test output"' },
        ],
      };

      const result = await collect(config, primitives);

      expect(result.context).toContain('test output');
      expect(result.confidence.by_source['echo "test output"']).toBe(1);
    });
  });

  describe('reliability', () => {
    it('reliability 为所有来源权重的平均值', async () => {
      const file1 = path.join(tmpDir, 'file1.txt');
      const file2 = path.join(tmpDir, 'file2.txt');
      
      await fs.writeFile(file1, 'Content 1');
      await fs.writeFile(file2, 'Content 2');

      const config: CollectConfig = {
        sources: [
          { type: 'file', query: file1, weight: 0.8 },
          { type: 'file', query: file2, weight: 1.0 },
        ],
      };

      const result = await collect(config, primitives);

      // (0.8 + 1.0) / 2 = 0.9
      expect(result.confidence.reliability).toBe(0.9);
    });
  });
});
