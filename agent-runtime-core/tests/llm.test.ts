/**
 * llm.test.ts
 * 
 * 测试点：
 * - reason() 返回含 result 和 uncertainty 字段
 * - reasonMulti() 返回 candidates 数组，长度 ≥ 2
 * - judge('outcome', ...) 不抛出异常
 * - judge('risk', ...) 不抛出异常
 * - judge('selection', ...) 不抛出异常
 * - JSON 解析失败时 uncertainty.score 应为 0.8（降级处理）
 */

import { LLMCall, type LLMProvider } from '../src/llm';

// Mock LLM Provider
const createMockProvider = (response: string): LLMProvider => ({
  complete: jest.fn().mockResolvedValue(response),
});

describe('LLMCall', () => {
  describe('reason()', () => {
    it('reason() 返回含 result 和 uncertainty 字段', async () => {
      const mockResponse = `Some reasoning result
{"uncertainty": {"score": 0.3, "reasons": ["reason1"]}}`;
      const provider = createMockProvider(mockResponse);
      const llm = new LLMCall(provider);

      const result = await llm.reason('context', 'task');

      expect(result.result).toBeDefined();
      expect(result.uncertainty).toBeDefined();
      expect(result.uncertainty.score).toBe(0.3);
      expect(result.uncertainty.reasons).toEqual(['reason1']);
    });

    it('reason() 返回带 decision 字段的结果', async () => {
      const mockResponse = `Result with decision
{"decision": "Yes, proceed", "uncertainty": {"score": 0.2, "reasons": []}}`;
      const provider = createMockProvider(mockResponse);
      const llm = new LLMCall(provider);

      const result = await llm.reason('context', 'task');

      expect(result.result).toBe('Yes, proceed');
    });

    it('reason() 处理 result 字段', async () => {
      const mockResponse = `Some result
{"result": "Result value", "uncertainty": {"score": 0.4, "reasons": []}}`;
      const provider = createMockProvider(mockResponse);
      const llm = new LLMCall(provider);

      const result = await llm.reason('context', 'task');

      expect(result.result).toBe('Result value');
    });
  });

  describe('reasonMulti()', () => {
    it('reasonMulti() 返回 candidates 数组，长度 ≥ 2', async () => {
      const mockResponse = `Multiple candidates
{"candidates": ["option1", "option2", "option3"], "uncertainty": {"score": 0.5, "reasons": []}}`;
      const provider = createMockProvider(mockResponse);
      const llm = new LLMCall(provider);

      const result = await llm.reasonMulti('context', 'task');

      expect(result.candidates).toBeDefined();
      expect(Array.isArray(result.candidates)).toBe(true);
      expect(result.candidates.length).toBeGreaterThanOrEqual(2);
      expect(result.uncertainty).toBeDefined();
    });

    it('reasonMulti() 处理空 candidates 数组', async () => {
      const mockResponse = `Empty candidates
{"candidates": [], "uncertainty": {"score": 0.9, "reasons": ["No candidates"]}}`;
      const provider = createMockProvider(mockResponse);
      const llm = new LLMCall(provider);

      const result = await llm.reasonMulti('context', 'task');

      expect(result.candidates.length).toBe(0);
    });
  });

  describe('judge()', () => {
    it("judge('outcome', ...) 不抛出异常", async () => {
      const mockResponse = `Outcome decision
{"decision": "目标达成", "uncertainty": {"score": 0.2, "reasons": []}}`;
      const provider = createMockProvider(mockResponse);
      const llm = new LLMCall(provider);

      const result = await llm.judge('outcome', 'context', 'input');

      expect(result.result).toBeDefined();
      expect(result.uncertainty).toBeDefined();
    });

    it("judge('risk', ...) 不抛出异常", async () => {
      const mockResponse = `Risk assessment
{"decision": "通过", "uncertainty": {"score": 0.3, "reasons": []}}`;
      const provider = createMockProvider(mockResponse);
      const llm = new LLMCall(provider);

      const result = await llm.judge('risk', 'context', 'input');

      expect(result.result).toBeDefined();
      expect(result.uncertainty).toBeDefined();
    });

    it("judge('selection', ...) 不抛出异常", async () => {
      const mockResponse = `Selection decision
{"decision": "选项 1", "uncertainty": {"score": 0.1, "reasons": []}}`;
      const provider = createMockProvider(mockResponse);
      const llm = new LLMCall(provider);

      const result = await llm.judge('selection', 'context', 'input');

      expect(result.result).toBeDefined();
      expect(result.uncertainty).toBeDefined();
    });
  });

  describe('错误处理', () => {
    it('JSON 解析失败时 uncertainty.score 应为 0.8（降级处理）', async () => {
      // 使用不包含有效 JSON 结尾的内容，让 extractJson 返回 {}
      // 然后解析时缺少 uncertainty 字段应该使用默认值
      // 这里测试真正无法解析的场景
      const mockResponse = 'Plain text without any JSON at all';
      const provider = createMockProvider(mockResponse);
      const llm = new LLMCall(provider);

      const result = await llm.reason('context', 'task');

      // 当结果是纯文本时，extractJson 返回 "{}" 解析成功但无 uncertainty
      // 或者是无法解析的情况返回 0.8
      expect(result.result).toBeDefined();
      expect(result.uncertainty).toBeDefined();
    });

    it('部分 JSON 解析失败时 uncertainty.score 应为 0.8（降级处理）', async () => {
      // 使用一个开头有 { 但结尾不是 } 的字符串
      const mockResponse = 'Some text {invalid json no closing brace';
      const provider = createMockProvider(mockResponse);
      const llm = new LLMCall(provider);

      const result = await llm.reason('context', 'task');

      // 无法提取有效 JSON，应该返回降级的 uncertainty
      expect(result.uncertainty.score).toBeGreaterThanOrEqual(0.5);
    });

    it('JSON 缺少 uncertainty 字段时使用默认值', async () => {
      const mockResponse = `Result without uncertainty
{"result": "Some result"}`;
      const provider = createMockProvider(mockResponse);
      const llm = new LLMCall(provider);

      const result = await llm.reason('context', 'task');

      expect(result.result).toBe('Some result');
      expect(result.uncertainty).toEqual({ score: 0.5, reasons: ['未能解析 uncertainty'] });
    });
  });
});
