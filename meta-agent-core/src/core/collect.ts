// [核心层 / 编排] core/collect.ts — Collect 骨架（file / bash / trace_tag / skills）

import type { Primitives } from './primitives';
import type { Confidence } from './trace';

export type CollectSource = {
  type: 'file' | 'bash' | 'trace_tag' | 'skills';
  query: string;             // 文件路径 / bash 命令 / trace 标签 / skills 关键词
  weight?: number;           // 可信度权重，默认 1.0
};

export type CollectResult = {
  context: string;
  confidence: Confidence;
};

export type CollectConfig = {
  sources: CollectSource[];
  filters?: string[];        // 关键词过滤（可选）
  maxTokens?: number;        // 上下文预算
};

export async function collect(
  config: CollectConfig,
  primitives: Primitives,
  traceFilterFn?: (tag: string) => Array<{ data: unknown }>,
  skillsDir?: string,  // 可选的 skills 目录路径
): Promise<CollectResult> {
  const parts: string[] = [];
  const bySource: Record<string, number> = {};
  const gaps: string[] = [];
  let successCount = 0;

  for (const source of config.sources) {
    try {
      let content = '';
      if (source.type === 'file') {
        content = await primitives.read(source.query);
      } else if (source.type === 'bash') {
        // bash 类型的 source 调用 primitives.bash()，会自动写入 TerminalLog
        content = await primitives.bash(source.query);
      } else if (source.type === 'trace_tag' && traceFilterFn) {
        const entries = traceFilterFn(source.query);
        content = entries.map(e => JSON.stringify(e.data)).join('\n');
      } else if (source.type === 'skills' && skillsDir) {
        // skills 类型：在 skillsDir/<name>/SKILL.md 中搜索匹配的文件
        // query 可以是文件名（不含 .md）或完整文件名
        try {
          // 先尝试直接读取 query 指定的文件（支持两种格式）
          // 1. skillsDir/<query>/SKILL.md（如 arxiv_api -> skills/arxiv_api/SKILL.md）
          // 2. skillsDir/<query>.md（如 arxiv_api -> skills/arxiv_api.md）
          let skillPath = `${skillsDir}/${source.query}/SKILL.md`;
          try {
            content = await primitives.read(skillPath);
          } catch {
            // 如果不存在，尝试不带 /SKILL.md 后缀
            skillPath = `${skillsDir}/${source.query}.md`;
            content = await primitives.read(skillPath);
          }
        } catch {
          // 如果直接读取失败，使用 bash grep 搜索 skills 目录
          const searchCmd = `ls ${skillsDir}/*.md ${skillsDir}/*/SKILL.md 2>/dev/null | xargs grep -l "${source.query}" 2>/dev/null | head -3`;
          const matchedFiles = await primitives.bash(searchCmd);
          if (matchedFiles && matchedFiles.trim()) {
            // 读取匹配的第一个文件
            const firstFile = matchedFiles.split('\n')[0].trim();
            if (firstFile) {
              content = await primitives.read(firstFile);
            }
          }
          if (!content) {
            throw new Error(`No skill found for: ${source.query}`);
          }
        }
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
    } catch (err) {
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
