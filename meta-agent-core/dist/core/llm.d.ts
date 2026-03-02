import type { Uncertainty } from './trace';
export type JudgeType = 'outcome' | 'risk' | 'selection' | 'capability';
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
    reason(context: string, input: string): Promise<LLMCallResult>;
    reasonMulti(context: string, input: string, n?: number): Promise<LLMCallMulti>;
    judge(type: JudgeType, context: string, input: string): Promise<LLMCallResult>;
    private parseWithUncertainty;
    /**
     * 提取 JSON 字符串
     * 沿用 v1 的正则：/{[\s\S]*}$/
     * 处理模型输出带 markdown 代码块的情况（先剥离 ```json 和 ```）
     */
    private extractJson;
}
//# sourceMappingURL=llm.d.ts.map