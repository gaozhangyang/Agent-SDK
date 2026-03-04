/**
 * Meta Agent Core HTTP 服务
 * 内部 import SDK，对外暴露 HTTP 接口，供 Python 等客户端调用
 * 基于 agent-runtime-core 的 /run 接口设计
 */
import { type CollectConfig } from '../index';
/** 请求体：运行一次 Agent 循环 */
export type RunRequestBody = {
    goal: string;
    subgoals?: string[];
    workDir: string;
    collectConfig: CollectConfig;
    llm: {
        baseUrl: string;
        model: string;
        apiKey: string;
    };
    thresholds?: {
        confidenceLow?: number;
        confidenceMid?: number;
        uncertaintyHigh?: number;
        maxIterations?: number;
        maxNoProgress?: number;
    };
    debug?: boolean;
    resume?: boolean;
};
//# sourceMappingURL=index.d.ts.map