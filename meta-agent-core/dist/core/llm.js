"use strict";
// [核心层 / LLM] core/llm.ts — LLMCall（Reason / Judge）+ LLMProvider 接口
// 修改：添加 proposalValid 字段，支持 AGENT.md section 过滤
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLMCall = void 0;
class LLMCall {
    provider;
    staticContext = ''; // 静态上下文（如 AGENT.md）
    agentMdSections = {}; // AGENT.md 各 section 内容
    constructor(provider) {
        this.provider = provider;
    }
    /**
     * 设置静态上下文（如 AGENT.md 内容）
     * 静态上下文会在每次 LLMCall 时自动注入
     */
    setStaticContext(context) {
        this.staticContext = context;
        this.parseAgentMdSections(context);
    }
    /**
     * 解析 AGENT.md 内容，提取各 section
     */
    parseAgentMdSections(content) {
        const sections = {};
        // 解析 # [all] 基础上下文
        const allMatch = content.match(/#\s*\[all\][\s\S]*?(?=#\s*\[|$)/);
        if (allMatch) {
            sections.all = allMatch[0].replace('# [all]', '').trim();
        }
        // 解析 # [reason] 策略与风险偏好
        const reasonMatch = content.match(/#\s*\[reason\][\s\S]*?(?=#\s*\[|$)/);
        if (reasonMatch) {
            sections.reason = reasonMatch[0].replace('# [reason]', '').trim();
        }
        // 解析 # [judge:outcome] 验收标准
        const judgeOutcomeMatch = content.match(/#\s*\[judge:outcome\][\s\S]*?(?=#\s*\[|$)/);
        if (judgeOutcomeMatch) {
            sections.judgeOutcome = judgeOutcomeMatch[0].replace('# [judge:outcome]', '').trim();
        }
        // 解析 # [judge:milestone] 里程碑判断标准
        const judgeMilestoneMatch = content.match(/#\s*\[judge:milestone\][\s\S]*?(?=#\s*\[|$)/);
        if (judgeMilestoneMatch) {
            sections.judgeMilestone = judgeMilestoneMatch[0].replace('# [judge:milestone]', '').trim();
        }
        // 解析 # [judge:capability] 能力边界
        const judgeCapabilityMatch = content.match(/#\s*\[judge:capability\][\s\S]*?(?=#\s*\[|$)/);
        if (judgeCapabilityMatch) {
            sections.judgeCapability = judgeCapabilityMatch[0].replace('# [judge:capability]', '').trim();
        }
        // 解析 # [learned_patterns] 历史提炼的策略参数
        const learnedMatch = content.match(/#\s*\[learned_patterns\][\s\S]*?(?=#\s*\[|$)/);
        if (learnedMatch) {
            sections.learnedPatterns = learnedMatch[0].replace('# [learned_patterns]', '').trim();
        }
        this.agentMdSections = sections;
    }
    /**
     * 获取指定类型的 AGENT.md section 内容
     */
    getAgentSection(type) {
        const sectionMap = {
            'all': 'all',
            'reason': 'reason',
            'judgeOutcome': 'judgeOutcome',
            'judgeMilestone': 'judgeMilestone',
            'judgeCapability': 'judgeCapability',
            'learnedPatterns': 'learnedPatterns',
        };
        return this.agentMdSections[sectionMap[type]] || '';
    }
    // Reason：发散生成提案
    async reason(context, input) {
        // 根据 README.md：使用 # [reason] section 作为策略上下文
        const reasonSection = this.getAgentSection('reason');
        const allSection = this.getAgentSection('all');
        const learnedSection = this.getAgentSection('learnedPatterns');
        const staticCtx = [
            allSection ? `\n## 基础上下文\n${allSection}` : '',
            reasonSection ? `\n## 策略与风险偏好\n${reasonSection}` : '',
            learnedSection ? `\n## 历史经验（只读）\n${learnedSection}` : '',
        ].filter(Boolean).join('\n');
        const system = `你是一个编码 Agent。请根据 context 完成任务，并在末尾以 JSON 输出：
{"result": "...", "uncertainty": {"score": 0-1, "reasons": []}, "riskApproved": true/false, "riskReason": "可选的风险说明", "proposalValid": true/false}.
重要提示：
1. 如果不确定，优先选择副作用最小的行动。
2. proposalValid 表示提案格式是否正确、是否可执行。
3. 你必须使用 <invoke name="工具名"> 格式来执行实际操作，不能只做分析。
4. 如果需要读取文件或执行命令，必须实际调用工具，不要只是描述要做什么。
5. Context 中已提供 AGENT.md 和 skills 的内容，请按照其中的 workflow 执行任务。
6. 工作目录是 survey_agent_python/，所有路径都相对于该目录。
7. 执行顺序：先 fetcher(arXiv API) → 再 screener(筛选) → 最后 analyst(分析写入知识库)。
若你的提案中包含工具调用（<invoke> 格式），uncertainty 评分应基于工具调用
执行后的预期状态来评估，而非将工具调用符号本身视为不确定因素。包含工具
调用的提案通常意味着需要先获取上下文再做判断，应给予较低的 uncertainty
评分以允许执行。${staticCtx}`;
        const raw = await this.provider.complete(system, `Context:\n${context}\n\nTask:\n${input}`);
        return this.parseWithUncertaintyRiskAndValid(raw);
    }
    // Reason（多候选）：uncertainty 高时使用
    async reasonMulti(context, input, n = 3) {
        // 根据 README.md：使用 # [reason] section 作为策略上下文
        const reasonSection = this.getAgentSection('reason');
        const allSection = this.getAgentSection('all');
        const staticCtx = [
            allSection ? `\n## 基础上下文\n${allSection}` : '',
            reasonSection ? `\n## 策略与风险偏好\n${reasonSection}` : '',
        ].filter(Boolean).join('\n');
        const system = `你是一个编码 Agent。请生成 ${n} 个候选方案，每个方案独立可用。
以 JSON 输出：{"candidates": ["方案1", "方案2", ...], "uncertainty": {"score": 0-1, "reasons": []}}${staticCtx}
若你的提案中包含工具调用（<invoke> 格式），uncertainty 评分应基于工具调用
执行后的预期状态来评估，而非将工具调用符号本身视为不确定因素。包含工具
调用的提案通常意味着需要先获取上下文再做判断，应给予较低的 uncertainty
评分以允许执行。`;
        const raw = await this.provider.complete(system, `Context:\n${context}\n\nTask:\n${input}`);
        const parsed = JSON.parse(this.extractJson(raw));
        return {
            candidates: parsed.candidates,
            uncertainty: parsed.uncertainty,
        };
    }
    // Judge：收敛裁决，必须显式指定 type
    async judge(type, context, input) {
        // 非法 type 立即抛出错误
        const validTypes = ['outcome', 'milestone', 'capability'];
        if (!validTypes.includes(type)) {
            throw new Error(`judge: unknown type "${type}"`);
        }
        // 根据 type 使用对应的 AGENT.md section
        let sectionContent = '';
        let typeDescription = '';
        switch (type) {
            case 'outcome':
                sectionContent = this.getAgentSection('judgeOutcome');
                typeDescription = '判断子目标是否达成（是/否 + 理由）';
                break;
            case 'milestone':
                sectionContent = this.getAgentSection('judgeMilestone');
                typeDescription = '判断当前完成点是否值得一个 git commit（是/否 + 理由）：判断标准：1. 当前完成点是否可以用一句话独立描述（功能完整性）；2. 回滚到此处是否有意义（可恢复性）；3. 与上次快照之间是否有实质变更';
                break;
            case 'capability':
                sectionContent = this.getAgentSection('judgeCapability');
                typeDescription = '判断任务是否在 agent 能力和权限范围内（完全可行/部分可行/不可行 + 理由）';
                break;
        }
        const allSection = this.getAgentSection('all');
        const staticCtx = [
            allSection ? `\n## 基础上下文\n${allSection}` : '',
            sectionContent ? `\n## ${typeDescription}\n${sectionContent}` : '',
        ].filter(Boolean).join('\n');
        const system = `你是一个裁决 Agent。任务类型：${typeDescription}。
请给出明确结论，并在末尾以 JSON 输出：
{"decision": "...", "uncertainty": {"score": 0-1, "reasons": []}}${staticCtx}`;
        const raw = await this.provider.complete(system, `Context:\n${context}\n\nInput:\n${input}`);
        return this.parseWithUncertainty(raw);
    }
    parseWithUncertainty(raw) {
        const jsonStr = this.extractJson(raw);
        try {
            const parsed = JSON.parse(jsonStr);
            // 如果解析结果是空对象，或者没有 uncertainty，也视为解析失败
            if (!parsed || (Object.keys(parsed).length === 0) || !parsed.uncertainty) {
                return {
                    result: raw,
                    uncertainty: { score: 0.8, reasons: ['JSON 解析失败'] },
                };
            }
            return {
                result: parsed.decision ?? parsed.result ?? raw,
                uncertainty: parsed.uncertainty,
            };
        }
        catch {
            return {
                result: raw,
                uncertainty: { score: 0.8, reasons: ['JSON 解析失败'] },
            };
        }
    }
    // v2: Reason 输出解析，包含 riskApproved 和 proposalValid 字段
    parseWithUncertaintyRiskAndValid(raw) {
        const jsonStr = this.extractJson(raw);
        try {
            const parsed = JSON.parse(jsonStr);
            // 如果解析结果是空对象，或者没有 uncertainty，也视为解析失败
            if (!parsed || (Object.keys(parsed).length === 0) || !parsed.uncertainty) {
                return {
                    result: raw,
                    uncertainty: { score: 0.8, reasons: ['JSON 解析失败'] },
                    riskApproved: true, // 解析失败时默认通过，让后续逻辑处理
                    riskReason: undefined, // 不设置误导性的 riskReason
                    proposalValid: true, // 默认认为有效
                };
            }
            return {
                result: parsed.decision ?? parsed.result ?? raw,
                uncertainty: parsed.uncertainty,
                riskApproved: parsed.riskApproved ?? true, // 默认通过
                riskReason: parsed.riskReason,
                proposalValid: parsed.proposalValid ?? true, // 新增：默认通过
            };
        }
        catch {
            return {
                result: raw,
                uncertainty: { score: 0.8, reasons: ['JSON 解析失败'] },
                riskApproved: true, // 解析失败时默认通过
                riskReason: undefined, // 不设置误导性的 riskReason
                proposalValid: true, // 默认认为有效
            };
        }
    }
    /**
     * 提取 JSON 字符串
     * 沿用 v1 的正则：/{[\s\S]*}$/
     * 处理模型输出带 markdown 代码块的情况（先剥离 ```json 和 ```）
     */
    extractJson(text) {
        // 先剥离 markdown 代码块
        let cleaned = text;
        const jsonBlockRegex = /```(?:json)?\s*([\s\S]*?)```/g;
        const matches = [...text.matchAll(jsonBlockRegex)];
        if (matches.length > 0) {
            // 取最后一个代码块的内容，并去除首尾空白
            cleaned = matches[matches.length - 1][1].trim();
        }
        // 然后用 v1 的正则匹配 JSON
        const match = cleaned.match(/\{[\s\S]*\}$/);
        return match ? match[0] : '{}';
    }
}
exports.LLMCall = LLMCall;
//# sourceMappingURL=llm.js.map