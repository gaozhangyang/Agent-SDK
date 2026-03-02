// [策略层 / 错误] hooks/error-classifier.ts — 错误四分类（标准 Hook 实现）

import type { LoopHooks } from '../runtime/loop';

/**
 * 错误分类规则（按优先级，从上到下匹配）
 * | 错误信息包含 | 分类 |
 * |------------|------|
 * | ETIMEDOUT / ECONNRESET / ECONNREFUSED / lock / busy / temporarily | 'retryable' |
 * | budget / token limit / rate limit / quota | 'budget' |
 * | ENOENT / EACCES / EPERM / permission denied / not found / no such file | 'environment' |
 * | 其他 | 'logic' |
 */

const ERROR_CLASSIFICATION_RULES: Array<{
  pattern: RegExp;
  classification: 'retryable' | 'logic' | 'environment' | 'budget';
}> = [
  // 可重试错误 - 网络超时、文件锁、临时资源不足
  { pattern: /(ETIMEDOUT|ECONNRESET|ECONNREFUSED|lock|busy|temporarily)/i, classification: 'retryable' },
  // 预算耗尽
  { pattern: /(budget|token\s+limit|rate\s+limit|quota)/i, classification: 'budget' },
  // 环境错误 - 依赖缺失、权限不足
  { pattern: /(ENOENT|EACCES|EPERM|permission\s+denied|not\s+found|no\s+such\s+file)/i, classification: 'environment' },
];

/**
 * 创建错误分类 Hook
 */
export function createErrorClassifier(): Pick<LoopHooks, 'classifyError'> {
  return {
    /**
     * 分类错误类型
     * 默认所有错误为 'logic'（进 Recovery）
     */
    classifyError: (error: unknown): 'retryable' | 'logic' | 'environment' | 'budget' => {
      const errorMessage = error instanceof Error ? error.message : String(error);

      for (const rule of ERROR_CLASSIFICATION_RULES) {
        if (rule.pattern.test(errorMessage)) {
          return rule.classification;
        }
      }

      // 默认分类为 logic（进 Recovery）
      return 'logic';
    },
  };
}
