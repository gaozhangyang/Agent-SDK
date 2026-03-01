/**
 * L0.3 — Collect 编排协议
 *
 * Collect 是编排协议，不是原语
 * 所有检索、过滤、截断的策略复杂性收敛于此
 */
import type { Primitives } from './primitives';
import type { Confidence } from './trace';
export type CollectSource = {
    type: 'file' | 'bash' | 'trace_tag';
    query: string;
    weight?: number;
};
export type CollectResult = {
    context: string;
    confidence: Confidence;
};
export type CollectConfig = {
    sources: CollectSource[];
    filters?: string[];
    maxTokens?: number;
};
/**
 * 上下文收集
 *
 * @param config - 收集配置
 * @param primitives - 执行原语
 * @param traceFilterFn - 可选的 trace 标签过滤函数
 */
export declare function collect(config: CollectConfig, primitives: Primitives, traceFilterFn?: (tag: string) => Array<{
    data: unknown;
}>): Promise<CollectResult>;
//# sourceMappingURL=collect.d.ts.map