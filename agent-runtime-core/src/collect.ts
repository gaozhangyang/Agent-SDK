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
  query: string;             // 文件路径 / bash 命令 / trace 标签
  weight?: number;           // 可信度权重，默认 1.0
};

export type CollectResult = {
  context: string;
  confidence: Confidence;
};

export type CollectConfig = {
  sources: CollectSource[];
  filters?: string[];        // 关键词过滤（可选）
  maxTokens?: number;        // L1.6 上下文预算
};

/**
 * 上下文收集
 * 
 * @param config - 收集配置
 * @param primitives - 执行原语
 * @param traceFilterFn - 可选的 trace 标签过滤函数
 */
export async function collect(
  config: CollectConfig,
  primitives: Primitives,
  traceFilterFn?: (tag: string) => Array<{ data: unknown }>,
): Promise<CollectResult> {
  const parts: string[] = [];
  const bySource: Record<string, number> = {};
  const gaps: string[] = [];
  let successCount = 0;
  const totalSources = config.sources.length;

  for (const source of config.sources) {
    try {
      let content = '';
      if (source.type === 'file') {
        content = await primitives.read(source.query);
      } else if (source.type === 'bash') {
        // L1.3 精确代码搜索：ripgrep / grep 优先于向量索引
        content = await primitives.bash(source.query);
      } else if (source.type === 'trace_tag' && traceFilterFn) {
        const entries = traceFilterFn(source.query);
        content = entries.map(e => JSON.stringify(e.data)).join('\n');
      }

      if (config.filters?.length) {
        const matched = config.filters.some(f => content.includes(f));
        if (!matched) {
          gaps.push(source.query);
          bySource[source.query] = 0;
          continue;
        }
      }

      parts.push(`[来源: ${source.query}]\n${content}`);
      bySource[source.query] = source.weight ?? 1.0;
      successCount++;
    } catch (err) {
      // 来源读取失败时该来源进入 gaps
      gaps.push(source.query);
      bySource[source.query] = 0;
    }
  }

  let context = parts.join('\n\n---\n\n');

  // L1.6：上下文预算截断（粗略按字符估算）
  // maxTokens * 4 是因为中文字符可能较多
  if (config.maxTokens && context.length > config.maxTokens * 4) {
    context = context.slice(0, config.maxTokens * 4) + '\n\n[... 已截断，超出 token 预算]';
  }

  // coverage = 成功来源数 / 总来源数
  const coverage = totalSources > 0 ? successCount / totalSources : 0;
  
  const avgReliability = Object.values(bySource).length > 0
    ? Object.values(bySource).reduce((a, b) => a + b, 0) / Object.values(bySource).length
    : 0;

  return {
    context,
    confidence: {
      coverage,
      reliability: avgReliability,
      gaps,
      by_source: bySource,
    },
  };
}
