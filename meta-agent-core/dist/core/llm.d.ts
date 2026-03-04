import type { Uncertainty } from './trace';
export type JudgeType = 'outcome' | 'milestone' | 'capability';
export type LLMCallResult = {
    result: string;
    uncertainty: Uncertainty;
    riskApproved?: boolean;
    riskReason?: string;
    proposalValid?: boolean;
};
export type LLMCallMulti = {
    candidates: string[];
    uncertainty: Uncertainty;
};
/**
 * AGENT.md section 过滤配置
 */
export type AgentMdSections = {
    all?: string;
    reason?: string;
    judgeOutcome?: string;
    judgeMilestone?: string;
    judgeCapability?: string;
    learnedPatterns?: string;
};
export interface LLMProvider {
    complete(systemPrompt: string, userMessage: string): Promise<string>;
}
export declare class LLMCall {
    private provider;
    private staticContext;
    private agentMdSections;
    constructor(provider: LLMProvider);
    /**
     * 设置静态上下文（如 AGENT.md 内容）
     * 静态上下文会在每次 LLMCall 时自动注入
     */
    setStaticContext(context: string): void;
    /**
     * 解析 AGENT.md 内容，提取各 section
     */
    private parseAgentMdSections;
    /**
     * 获取指定类型的 AGENT.md section 内容
     */
    getAgentSection(type: 'all' | 'reason' | 'judgeOutcome' | 'judgeMilestone' | 'judgeCapability' | 'learnedPatterns'): string;
    reason(context: string, input: string): Promise<LLMCallResult>;
    execute(context: string, task: string, result: string): Promise<string>;
    /**
     * 从 LLM 输出中提取 <invoke> 标签部分
     */
    private extractInvocations;
    reasonMulti(context: string, input: string, n?: number): Promise<LLMCallMulti>;
    judge(type: JudgeType, context: string, input: string): Promise<LLMCallResult>;
    private parseWithUncertainty;
    private parseWithUncertaintyRiskAndValid;
    /**
     * 提取 JSON 字符串
     * 沿用 v1 的正则：/{[\s\S]*}$/
     * 处理模型输出带 markdown 代码块的情况（先剥离 ```json 和 ```）
     */
    private extractJson;
}
//# sourceMappingURL=llm.d.ts.map