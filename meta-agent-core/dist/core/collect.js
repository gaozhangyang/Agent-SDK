"use strict";
// [核心层 / 编排] core/collect.ts — Collect 骨架（file / bash / trace_tag）
Object.defineProperty(exports, "__esModule", { value: true });
exports.collect = collect;
async function collect(config, primitives, traceFilterFn) {
    const parts = [];
    const bySource = {};
    const gaps = [];
    let successCount = 0;
    for (const source of config.sources) {
        try {
            let content = '';
            if (source.type === 'file') {
                content = await primitives.read(source.query);
            }
            else if (source.type === 'bash') {
                // bash 类型的 source 调用 primitives.bash()，会自动写入 TerminalLog
                content = await primitives.bash(source.query);
            }
            else if (source.type === 'trace_tag' && traceFilterFn) {
                const entries = traceFilterFn(source.query);
                content = entries.map(e => JSON.stringify(e.data)).join('\n');
            }
            if (config.filters?.length) {
                // 检查是否包含过滤器中的关键词
                // 使用子字符串匹配
                const matched = config.filters.some(f => content.includes(f));
                if (!matched) {
                    gaps.push(source.query);
                    // 过滤不匹配也计入失败
                    bySource[source.query] = 0;
                    continue;
                }
            }
            parts.push(`[来源: ${source.query}]\n${content}`);
            bySource[source.query] = source.weight ?? 1.0;
            successCount++;
        }
        catch (err) {
            gaps.push(source.query);
            bySource[source.query] = 0;
        }
    }
    let context = parts.join('\n\n---\n\n');
    // maxTokens 截断：1 token ≈ 4 字符
    if (config.maxTokens && context.length > config.maxTokens * 4) {
        context = context.slice(0, config.maxTokens * 4) + '\n\n[... 已截断，超出 token 预算]';
    }
    // coverage = 成功数 / 总数（失败 source 计入分母但不计入分子）
    const filledRatio = successCount / Math.max(config.sources.length, 1);
    const avgReliability = Object.values(bySource).length > 0
        ? Object.values(bySource).reduce((a, b) => a + b, 0) / Object.values(bySource).length
        : 0;
    return {
        context,
        confidence: {
            coverage: filledRatio,
            reliability: avgReliability,
            gaps,
            by_source: bySource,
        },
    };
}
//# sourceMappingURL=collect.js.map