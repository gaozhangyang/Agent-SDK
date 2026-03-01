/**
 * Trace - 系统调试基础
 * 
 * 所有 confidence 和 uncertainty 统一写入 Trace
 * 这是整个系统可调试性的基础
 */

export type TraceEntryKind = 
  | 'collect' 
  | 'reason' 
  | 'judge' 
  | 'exec' 
  | 'observe' 
  | 'state' 
  | 'escalate' 
  | 'stop';

export type Confidence = {
  coverage: number;            // 0-1，信息充分性
  reliability: number;        // 0-1，信息可信度
  gaps: string[];             // 缺少哪些信息
  by_source: Record<string, number>; // 每个来源的可信度
};

export type Uncertainty = {
  score: number;              // 0-1，输出可靠性的反面
  reasons: string[];          // 具体不确定原因
};

export type TraceEntry = {
  ts: number;                  // Unix ms
  kind: TraceEntryKind;
  data: unknown;              // 任意结构化数据
  confidence?: Confidence;    // Collect 产出，写入此字段
  uncertainty?: Uncertainty;  // LLMCall 产出，写入此字段
  tags?: string[];            // L1.4 标签约定（可选）
};

export class Trace {
  private entries: TraceEntry[] = [];

  /**
   * 追加新的 Trace 条目
   */
  append(entry: TraceEntry): void {
    this.entries.push(entry);
  }

  /**
   * L1.4：标签过滤检索（bash grep 的 TS 等价）
   */
  filterByTag(tag: string): TraceEntry[] {
    return this.entries.filter(e => e.tags?.includes(tag));
  }

  /**
   * 获取所有 Trace 条目
   */
  all(): TraceEntry[] {
    return [...this.entries];
  }

  /**
   * 序列化供持久化或调试
   */
  serialize(): string {
    return JSON.stringify(this.entries, null, 2);
  }

  /**
   * 获取条目数量
   */
  length(): number {
    return this.entries.length;
  }

  /**
   * 清空所有条目（测试用）
   */
  clear(): void {
    this.entries = [];
  }
}
