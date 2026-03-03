// [核心层 / LLM] core/llm.ts — LLMCall（Reason / Judge）+ LLMProvider 接口

import type { Uncertainty } from './trace';

export type JudgeType = 'outcome' | 'risk' | 'selection' | 'milestone' | 'capability';
// v2: 'capability' 用于启动时的能力边界声明
// v2: 'milestone' 用于判断当前完成点是否值得一个 git commit

export type LLMCallResult = {
  result: string;
  uncertainty: Uncertainty;
  riskApproved?: boolean;   // v2: 模型自评此提案是否可安全执行
  riskReason?: string;     // v2: 风险说明
};

export type LLMCallMulti = {
  candidates: string[];
  uncertainty: Uncertainty;
};

export interface LLMProvider {
  complete(systemPrompt: string, userMessage: string): Promise<string>;
}

export class LLMCall {
  private staticContext: string = '';  // 静态上下文（如 AGENT.md）

  constructor(private provider: LLMProvider) {}

  /**
   * 设置静态上下文（如 AGENT.md 内容）
   * 静态上下文会在每次 LLMCall 时自动注入
   */
  setStaticContext(context: string): void {
    this.staticContext = context;
  }

  // Reason：发散生成提案
  async reason(context: string, input: string): Promise<LLMCallResult> {
    const staticCtx = this.staticContext ? `\n\n## 静态上下文（AGENT.md）\n${this.staticContext}\n` : '';
    const system = `你是一个编码 Agent。请根据 context 完成任务，并在末尾以 JSON 输出：
{"result": "...", "uncertainty": {"score": 0-1, "reasons": []}, "riskApproved": true/false, "riskReason": "可选的风险说明"}.
重要提示：如果不确定，优先选择副作用最小的行动。${staticCtx}`;
    const raw = await this.provider.complete(system, `Context:\n${context}\n\nTask:\n${input}`);
    return this.parseWithUncertaintyAndRisk(raw);
  }

  // Reason（多候选）：uncertainty 高时使用
  async reasonMulti(context: string, input: string, n = 3): Promise<LLMCallMulti> {
    const staticCtx = this.staticContext ? `\n\n## 静态上下文（AGENT.md）\n${this.staticContext}\n` : '';
    const system = `你是一个编码 Agent。请生成 ${n} 个候选方案，每个方案独立可用。
以 JSON 输出：{"candidates": ["方案1", "方案2", ...], "uncertainty": {"score": 0-1, "reasons": []}}${staticCtx}`;
    const raw = await this.provider.complete(system, `Context:\n${context}\n\nTask:\n${input}`);
    const parsed = JSON.parse(this.extractJson(raw));
    return {
      candidates: parsed.candidates,
      uncertainty: parsed.uncertainty,
    };
  }

  // Judge：收敛裁决，必须显式指定 type
  async judge(type: JudgeType, context: string, input: string): Promise<LLMCallResult> {
    // 非法 type 立即抛出错误
    const validTypes: JudgeType[] = ['outcome', 'risk', 'selection', 'milestone', 'capability'];
    if (!validTypes.includes(type)) {
      throw new Error(`judge: unknown type "${type}"`);
    }

    const typeDescriptions: Record<JudgeType, string> = {
      outcome: '判断子目标是否达成（是/否 + 理由）',
      risk: '判断操作是否允许执行，权限是否满足（通过/拒绝 + 理由）',
      selection: '从多个候选方案中选出最优（选项编号 + 理由）',
      milestone: '判断当前完成点是否值得一个 git commit（是/否 + 理由）：判断标准：1. 当前完成点是否可以用一句话独立描述（功能完整性）；2. 回滚到此处是否有意义（可恢复性）；3. 与上次快照之间是否有实质变更',
      capability: '判断任务是否在 agent 能力和权限范围内（完全可行/部分可行/不可行 + 理由）',
    };

    const staticCtx = this.staticContext ? `\n\n## 静态上下文（AGENT.md）\n${this.staticContext}\n` : '';
    const system = `你是一个裁决 Agent。任务类型：${typeDescriptions[type]}。
请给出明确结论，并在末尾以 JSON 输出：
{"decision": "...", "uncertainty": {"score": 0-1, "reasons": []}}${staticCtx}`;
    const raw = await this.provider.complete(system, `Context:\n${context}\n\nInput:\n${input}`);
    return this.parseWithUncertainty(raw);
  }

  private parseWithUncertainty(raw: string): LLMCallResult {
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
    } catch {
      return {
        result: raw,
        uncertainty: { score: 0.8, reasons: ['JSON 解析失败'] },
      };
    }
  }

  // v2: Reason 输出解析，包含 riskApproved 字段
  private parseWithUncertaintyAndRisk(raw: string): LLMCallResult {
    const jsonStr = this.extractJson(raw);
    try {
      const parsed = JSON.parse(jsonStr);
      // 如果解析结果是空对象，或者没有 uncertainty，也视为解析失败
      if (!parsed || (Object.keys(parsed).length === 0) || !parsed.uncertainty) {
        return {
          result: raw,
          uncertainty: { score: 0.8, reasons: ['JSON 解析失败'] },
          riskApproved: true, // 解析失败时默认通过，让后续逻辑处理
          riskReason: 'JSON 解析失败',
        };
      }
      return {
        result: parsed.decision ?? parsed.result ?? raw,
        uncertainty: parsed.uncertainty,
        riskApproved: parsed.riskApproved ?? true,  // 默认通过
        riskReason: parsed.riskReason,
      };
    } catch {
      return {
        result: raw,
        uncertainty: { score: 0.8, reasons: ['JSON 解析失败'] },
        riskApproved: true, // 解析失败时默认通过
        riskReason: 'JSON 解析失败',
      };
    }
  }

  /**
   * 提取 JSON 字符串
   * 沿用 v1 的正则：/{[\s\S]*}$/
   * 处理模型输出带 markdown 代码块的情况（先剥离 ```json 和 ```）
   */
  private extractJson(text: string): string {
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
