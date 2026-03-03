import type { Uncertainty } from './trace';
export type JudgeType = 'outcome' | 'milestone' | 'capability';
export type LLMCallResult = {
    result: string;
    uncertainty: Uncertainty;
    riskApproved?: boolean;
    riskReason?: string;
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
    private staticContext;
    constructor(provider: LLMProvider);
    /**
     * 设置静态上下文（如 AGENT.md 内容）
     * 静态上下文会在每次 LLMCall 时自动注入
     */
    setStaticContext(context: string): void;
    reason(context: string, input: string): Promise<LLMCallResult>;
    reasonMulti(context: string, input: string, n?: number): Promise<LLMCallMulti>;
    judge(type: JudgeType, context: string, input: string): Promise<LLMCallResult>;
    private parseWithUncertainty;
    private parseWithUncertaintyAndRisk;
    /**
     * 提取 JSON 字符串
     * 沿用 v1 的正则：/{[\s\S]*}$/
     * 处理模型输出带 markdown 代码块的情况（先剥离 ```json 和 ```）
     */
    private extractJson;
}
//# sourceMappingURL=llm.d.ts.map