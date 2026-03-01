/**
 * L0.2 — LLMCall（推理引擎）
 *
 * 两种模式：Reason（发散生成）和 Judge（收敛裁决）
 * Judge 必须显式指定 type
 */
import type { Uncertainty } from './trace';
export type JudgeType = 'outcome' | 'risk' | 'selection';
export type LLMCallResult = {
    result: string;
    uncertainty: Uncertainty;
};
export type LLMCallMulti = {
    candidates: string[];
    uncertainty: Uncertainty;
};
export interface LLMProvider {
    complete(systemPrompt: string, userMessage: string): Promise<string>;
}
export declare class LLMCall {
    private provider;
    constructor(provider: LLMProvider);
    /**
     * Reason：发散生成提案
     */
    reason(context: string, input: string): Promise<LLMCallResult>;
    /**
     * Reason（多候选）：uncertainty 高时使用
     */
    reasonMulti(context: string, input: string, n?: number): Promise<LLMCallMulti>;
    /**
     * Judge：收敛裁决，必须显式指定 type
     * @param type - 'outcome' | 'risk' | 'selection'
     */
    judge(type: JudgeType, context: string, input: string): Promise<LLMCallResult>;
    /**
     * 解析 LLM 输出并提取 uncertainty
     * JSON 解析失败时 uncertainty.score 应为 0.8（降级处理）
     */
    private parseWithUncertainty;
    /**
     * 从文本中提取 JSON（查找最后一个 {...} 块）
     */
    private extractJson;
}
//# sourceMappingURL=llm.d.ts.map