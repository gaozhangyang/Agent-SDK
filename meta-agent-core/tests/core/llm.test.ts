// tests/core/llm.test.ts

import { LLMCall, LLMProvider, JudgeType } from '../../src/core/llm';

describe('LLMCall', () => {
  // Mock LLMProvider
  const mockProvider: LLMProvider = {
    complete: jest.fn(),
  };

  let llm: LLMCall;

  beforeEach(() => {
    jest.clearAllMocks();
    llm = new LLMCall(mockProvider);
  });

  test('reason() 返回含 result 和 uncertainty 字段', async () => {
    (mockProvider.complete as jest.Mock).mockResolvedValue(
      '{"result": "test result", "uncertainty": {"score": 0.3, "reasons": []}}'
    );

    const result = await llm.reason('context', 'task');

    expect(result.result).toBe('test result');
    expect(result.uncertainty).toEqual({ score: 0.3, reasons: [] });
  });

  test('reasonMulti() 返回 candidates 数组，长度 >= 2', async () => {
    (mockProvider.complete as jest.Mock).mockResolvedValue(
      '{"candidates": ["option1", "option2", "option3"], "uncertainty": {"score": 0.4, "reasons": []}}'
    );

    const result = await llm.reasonMulti('context', 'task', 3);

    expect(result.candidates).toHaveLength(3);
    expect(result.candidates).toContain('option1');
    expect(result.uncertainty).toEqual({ score: 0.4, reasons: [] });
  });

  test('judge(outcome, ...) 不抛出异常', async () => {
    (mockProvider.complete as jest.Mock).mockResolvedValue(
      '{"decision": "通过", "uncertainty": {"score": 0.2, "reasons": []}}'
    );

    const result = await llm.judge('outcome', 'context', 'input');

    expect(result.result).toBe('通过');
    expect(result.uncertainty.score).toBe(0.2);
  });

  test('judge(capability, ...) 不抛出异常（v2 新增）', async () => {
    (mockProvider.complete as jest.Mock).mockResolvedValue(
      '{"decision": "完全可行", "uncertainty": {"score": 0.1, "reasons": []}}'
    );

    const result = await llm.judge('capability', 'context', 'task');

    expect(result.result).toBe('完全可行');
    expect(mockProvider.complete).toHaveBeenCalled();
    // 验证 capability 类型的 prompt 被正确传递 - 包含中文描述
    const callArgs = (mockProvider.complete as jest.Mock).mock.calls[0];
    expect(callArgs[0]).toContain('能力');
  });

  test('传入非法 type 时抛出错误', async () => {
    (mockProvider.complete as jest.Mock).mockResolvedValue('{}');

    await expect(llm.judge('unknown' as JudgeType, 'ctx', 'input'))
      .rejects.toThrow('judge: unknown type "unknown"');
  });

  test('JSON 完全无法解析时 uncertainty.score 为 0.8', async () => {
    // 没有任何有效 JSON 格式的字符串
    (mockProvider.complete as jest.Mock).mockResolvedValue('这是一个无效的响应，没有任何 JSON');

    const result = await llm.reason('context', 'task');

    expect(result.uncertainty.score).toBe(0.8);
    expect(result.uncertainty.reasons).toContain('JSON 解析失败');
  });

  test('extractJson 处理 markdown 代码块', async () => {
    (mockProvider.complete as jest.Mock).mockResolvedValue(
      '```json\n{"result": "test", "uncertainty": {"score": 0.5}}\n```'
    );

    const result = await llm.reason('context', 'task');

    // 应该能解析出 JSON
    expect(result.result).toBe('test');
    expect(result.uncertainty.score).toBe(0.5);
  });

  test('judge 包含中英文 pass/approved/yes', async () => {
    (mockProvider.complete as jest.Mock).mockResolvedValue(
      '{"decision": "pass", "uncertainty": {"score": 0.1, "reasons": []}}'
    );

    const result = await llm.judge('risk', 'context', 'input');

    expect(result.result).toBe('pass');
  });
});
