/**
 * Trace - 系统调试基础
 *
 * 所有 confidence 和 uncertainty 统一写入 Trace
 * 这是整个系统可调试性的基础
 */
export type TraceEntryKind = 'collect' | 'reason' | 'judge' | 'exec' | 'observe' | 'state' | 'escalate' | 'stop';
export type Confidence = {
    coverage: number;
    reliability: number;
    gaps: string[];
    by_source: Record<string, number>;
};
export type Uncertainty = {
    score: number;
    reasons: string[];
};
export type TraceEntry = {
    ts: number;
    kind: TraceEntryKind;
    data: unknown;
    confidence?: Confidence;
    uncertainty?: Uncertainty;
    tags?: string[];
};
export declare class Trace {
    private entries;
    /**
     * 追加新的 Trace 条目
     */
    append(entry: TraceEntry): void;
    /**
     * L1.4：标签过滤检索（bash grep 的 TS 等价）
     */
    filterByTag(tag: string): TraceEntry[];
    /**
     * 获取所有 Trace 条目
     */
    all(): TraceEntry[];
    /**
     * 序列化供持久化或调试
     */
    serialize(): string;
    /**
     * 获取条目数量
     */
    length(): number;
    /**
     * 清空所有条目（测试用）
     */
    clear(): void;
}
//# sourceMappingURL=trace.d.ts.map