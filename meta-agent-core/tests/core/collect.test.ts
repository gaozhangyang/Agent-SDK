// tests/core/collect.test.ts

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { collect, CollectConfig } from '../../src/core/collect';
import { localPrimitives } from '../../src/core/primitives';
import { TerminalLog } from '../../src/core/trace';

describe('collect', () => {
  let tempDir: string;
  let primitives: ReturnType<typeof localPrimitives>;
  let terminalLog: TerminalLog;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'collect-test-'));
    terminalLog = new TerminalLog();
    primitives = localPrimitives(tempDir, terminalLog);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('coverage = 成功来源数 / 总来源数', async () => {
    // 创建两个文件，一个存在一个不存在
    const config: CollectConfig = {
      sources: [
        { type: 'file', query: path.join(tempDir, 'exists.txt') },
        { type: 'file', query: path.join(tempDir, 'notexists.txt') },
      ],
    };

    await fs.writeFile(path.join(tempDir, 'exists.txt'), 'content', 'utf-8');

    const result = await collect(config, primitives);

    // 一个成功，一个失败
    expect(result.confidence.coverage).toBe(0.5);
  });

  test('来源失败时进入 gaps，by_source 中该 key 为 0', async () => {
    const config: CollectConfig = {
      sources: [
        { type: 'file', query: path.join(tempDir, 'missing.txt') },
      ],
    };

    const result = await collect(config, primitives);

    expect(result.confidence.gaps).toContain(path.join(tempDir, 'missing.txt'));
    expect(result.confidence.by_source[path.join(tempDir, 'missing.txt')]).toBe(0);
  });

  test('maxTokens 生效时 context 长度不超过 maxTokens * 4 字符', async () => {
    const longContent = 'a'.repeat(10000);
    await fs.writeFile(path.join(tempDir, 'long.txt'), longContent, 'utf-8');

    const config: CollectConfig = {
      sources: [
        { type: 'file', query: path.join(tempDir, 'long.txt') },
      ],
      maxTokens: 1000, // 1000 * 4 = 4000 字符
    };

    const result = await collect(config, primitives);

    expect(result.context.length).toBeLessThanOrEqual(4000 + 50); // 允许一些误差
    expect(result.context).toContain('[... 已截断，超出 token 预算]');
  });

  test('bash 类型的 source 调用 primitives.bash()', async () => {
    const config: CollectConfig = {
      sources: [
        { type: 'bash', query: 'echo hello' },
      ],
    };

    const result = await collect(config, primitives);

    expect(result.context).toContain('hello');
    expect(result.confidence.by_source['echo hello']).toBe(1);
  });

  test('trace_tag 类型的 source 使用 traceFilterFn', async () => {
    const mockFilterFn = jest.fn().mockReturnValue([
      { data: { test: 1 } },
      { data: { test: 2 } },
    ]);

    const config: CollectConfig = {
      sources: [
        { type: 'trace_tag', query: 'test-tag' },
      ],
    };

    const result = await collect(config, primitives, mockFilterFn);

    expect(mockFilterFn).toHaveBeenCalledWith('test-tag');
    expect(result.context).toContain('{"test":1}');
    expect(result.context).toContain('{"test":2}');
  });

  test('filters 过滤不匹配的内容', async () => {
    // 使用一个真正不包含 keyword 的内容
    await fs.writeFile(path.join(tempDir, 'test.txt'), 'some content here', 'utf-8');

    const config: CollectConfig = {
      sources: [
        { type: 'file', query: path.join(tempDir, 'test.txt') },
      ],
      filters: ['keyword'],
    };

    const result = await collect(config, primitives);

    // 过滤不匹配，应该计入 gaps
    expect(result.confidence.gaps).toContain(path.join(tempDir, 'test.txt'));
    expect(result.confidence.coverage).toBe(0);
  });

  test('filters 匹配的内容通过', async () => {
    await fs.writeFile(path.join(tempDir, 'test.txt'), 'some content with keyword', 'utf-8');

    const config: CollectConfig = {
      sources: [
        { type: 'file', query: path.join(tempDir, 'test.txt') },
      ],
      filters: ['keyword'],
    };

    const result = await collect(config, primitives);

    expect(result.confidence.gaps).not.toContain(path.join(tempDir, 'test.txt'));
    expect(result.confidence.coverage).toBe(1);
  });
});
