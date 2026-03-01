/**
 * trace.test.ts
 * 
 * 测试点：
 * - append() 后 all() 长度正确
 * - filterByTag() 只返回含该 tag 的条目
 * - serialize() 输出合法 JSON
 */

import { Trace } from '../src/trace';

describe('Trace', () => {
  let trace: Trace;

  beforeEach(() => {
    trace = new Trace();
  });

  describe('append() 和 all()', () => {
    it('append() 后 all() 长度正确', () => {
      expect(trace.all().length).toBe(0);
      
      trace.append({ ts: Date.now(), kind: 'collect', data: {} });
      expect(trace.all().length).toBe(1);
      
      trace.append({ ts: Date.now(), kind: 'reason', data: {} });
      expect(trace.all().length).toBe(2);
      
      trace.append({ ts: Date.now(), kind: 'judge', data: {} });
      expect(trace.all().length).toBe(3);
    });

    it('append 多个条目后长度正确', () => {
      for (let i = 0; i < 10; i++) {
        trace.append({ ts: Date.now(), kind: 'collect', data: { i } });
      }
      expect(trace.all().length).toBe(10);
    });
  });

  describe('filterByTag()', () => {
    it('filterByTag() 只返回含该 tag 的条目', () => {
      trace.append({ ts: Date.now(), kind: 'collect', data: {}, tags: ['tag1', 'tag2'] });
      trace.append({ ts: Date.now(), kind: 'reason', data: {}, tags: ['tag1'] });
      trace.append({ ts: Date.now(), kind: 'judge', data: {}, tags: ['tag2'] });
      trace.append({ ts: Date.now(), kind: 'exec', data: {} }); // 无 tag

      const filtered = trace.filterByTag('tag1');
      expect(filtered.length).toBe(2);
      expect(filtered.every(e => e.tags?.includes('tag1'))).toBe(true);
    });

    it('filterByTag() 对不存在的 tag 返回空数组', () => {
      trace.append({ ts: Date.now(), kind: 'collect', data: {}, tags: ['tag1'] });
      
      const filtered = trace.filterByTag('nonexistent');
      expect(filtered.length).toBe(0);
    });
  });

  describe('serialize()', () => {
    it('serialize() 输出合法 JSON', () => {
      trace.append({ ts: Date.now(), kind: 'collect', data: { key: 'value' } });
      trace.append({ ts: Date.now(), kind: 'reason', data: { result: 'test' } });

      const serialized = trace.serialize();
      
      // 应该能解析为合法 JSON
      expect(() => JSON.parse(serialized)).not.toThrow();
      
      const parsed = JSON.parse(serialized);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(2);
    });

    it('serialize() 包含正确的字段', () => {
      const ts = Date.now();
      trace.append({ 
        ts, 
        kind: 'collect', 
        data: { sources: ['file1'] },
        confidence: { coverage: 0.8, reliability: 0.9, gaps: [], by_source: {} },
      });

      const serialized = trace.serialize();
      const parsed = JSON.parse(serialized);
      
      expect(parsed[0].ts).toBe(ts);
      expect(parsed[0].kind).toBe('collect');
      expect(parsed[0].data.sources).toEqual(['file1']);
      expect(parsed[0].confidence.coverage).toBe(0.8);
    });
  });

  describe('其他方法', () => {
    it('length() 返回正确数量', () => {
      trace.append({ ts: Date.now(), kind: 'collect', data: {} });
      trace.append({ ts: Date.now(), kind: 'reason', data: {} });
      expect(trace.length()).toBe(2);
    });

    it('clear() 清空所有条目', () => {
      trace.append({ ts: Date.now(), kind: 'collect', data: {} });
      trace.append({ ts: Date.now(), kind: 'reason', data: {} });
      
      trace.clear();
      
      expect(trace.all().length).toBe(0);
      expect(trace.length()).toBe(0);
    });

    it('all() 返回浅拷贝，不影响原数组', () => {
      trace.append({ ts: Date.now(), kind: 'collect', data: {} });
      
      const all1 = trace.all();
      const all2 = trace.all();
      
      // 修改返回的数组不应该影响内部状态
      all1.push({ ts: Date.now(), kind: 'exec', data: {} });
      
      expect(trace.all().length).toBe(1);
      expect(all2.length).toBe(1);
    });
  });
});
