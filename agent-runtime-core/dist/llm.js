"use strict";
/**
 * L0.2 — LLMCall（推理引擎）
 *
 * 两种模式：Reason（发散生成）和 Judge（收敛裁决）
 * Judge 必须显式指定 type
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLMCall = void 0;
class LLMCall {
    provider;
    constructor(provider) {
        this.provider = provider;
    }
    /**
     * Reason：发散生成提案
     */
    async reason(context, input) {
        const system = `你是一个编码 Agent。请根据 context 完成任务，并在末尾以 JSON 输出：
{"uncertainty": {"score": 0-1, "reasons": []}}`;
        const raw = await this.provider.complete(system, `Context:\n${context}\n\nTask:\n${input}`);
        return this.parseWithUncertainty(raw);
    }
    /**
     * Reason（多候选）：uncertainty 高时使用
     */
    async reasonMulti(context, input, n = 3) {
        const system = `你是一个编码 Agent。请生成 ${n} 个候选方案，每个方案独立可用。
以 JSON 输出：{"candidates": ["方案1", "方案2", ...], "uncertainty": {"score": 0-1, "reasons": []}}`;
        const raw = await this.provider.complete(system, `Context:\n${context}\n\nTask:\n${input}`);
        const parsed = JSON.parse(this.extractJson(raw));
        return {
            candidates: parsed.candidates,
            uncertainty: parsed.uncertainty,
        };
    }
    /**
     * Judge：收敛裁决，必须显式指定 type
     * @param type - 'outcome' | 'risk' | 'selection'
     */
    async judge(type, context, input) {
        const typeDescriptions = {
            outcome: '判断子目标是否达成（是/否 + 理由）',
            risk: '判断操作是否允许执行，权限是否满足（通过/拒绝 + 理由）',
            selection: '从多个候选方案中选出最优（选项编号 + 理由）',
        };
        const system = `你是一个裁决 Agent。任务类型：${typeDescriptions[type]}。
请给出明确结论，并在末尾以 JSON 输出：
{"decision": "...", "uncertainty": {"score": 0-1, "reasons": []}}`;
        const raw = await this.provider.complete(system, `Context:\n${context}\n\nInput:\n${input}`);
        return this.parseWithUncertainty(raw);
    }
    /**
     * 解析 LLM 输出并提取 uncertainty
     * JSON 解析失败时 uncertainty.score 应为 0.8（降级处理）
     */
    parseWithUncertainty(raw) {
        const jsonStr = this.extractJson(raw);
        try {
            const parsed = JSON.parse(jsonStr);
            return {
                result: parsed.decision ?? parsed.result ?? raw,
                uncertainty: parsed.uncertainty ?? { score: 0.5, reasons: ['未能解析 uncertainty'] },
            };
        }
        catch {
            // JSON 解析失败，降级处理
            return {
                result: raw,
                uncertainty: { score: 0.8, reasons: ['JSON 解析失败'] },
            };
        }
    }
    /**
     * 从文本中提取 JSON（查找最后一个 {...} 块）
     */
    extractJson(text) {
        const match = text.match(/\{[\s\S]*\}$/);
        return match ? match[0] : '{}';
    }
}
exports.LLMCall = LLMCall;
//# sourceMappingURL=llm.js.map