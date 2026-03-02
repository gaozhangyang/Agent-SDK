import type { Primitives } from './primitives';
import type { Confidence } from './trace';
export type CollectSource = {
    type: 'file' | 'bash' | 'trace_tag' | 'skills';
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
export declare function collect(config: CollectConfig, primitives: Primitives, traceFilterFn?: (tag: string) => Array<{
    data: unknown;
}>, skillsDir?: string): Promise<CollectResult>;
//# sourceMappingURL=collect.d.ts.map