"use strict";
/**
 * Agent Runtime Core HTTP 服务
 * 内部 import SDK，对外暴露 HTTP 接口，供 Python 等客户端调用
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const express_1 = __importDefault(require("express"));
const index_1 = require("../index");
const primitives_1 = require("./primitives");
const app = (0, express_1.default)();
app.use(express_1.default.json({ limit: '2mb' }));
/** 可序列化的 State 摘要（供 HTTP 返回） */
function serializeState(s) {
    return {
        goal: s.goal,
        subgoals: s.subgoals,
        currentSubgoal: s.currentSubgoal,
        mode: s.mode,
        permissions: s.permissions,
        iterationCount: s.iterationCount,
        noProgressCount: s.noProgressCount,
        version: s.version,
        custom: s.custom,
    };
}
/** 健康检查 */
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'agent-runtime-core' });
});
/**
 * POST /run
 * 执行一次 Agent 循环，返回 status、state 摘要、trace 序列化
 */
app.post('/run', async (req, res) => {
    try {
        const body = req.body;
        const { goal, subgoals = [], workDir, collectConfig, llm: llmConfig, thresholds } = body;
        if (!goal || typeof workDir !== 'string') {
            res.status(400).json({ error: '缺少 goal 或 workDir' });
            return;
        }
        if (!collectConfig?.sources?.length) {
            res.status(400).json({ error: 'collectConfig.sources 不能为空' });
            return;
        }
        if (!llmConfig?.baseUrl || !llmConfig?.model || !llmConfig?.apiKey) {
            res.status(400).json({ error: 'llm 需提供 baseUrl、model、apiKey' });
            return;
        }
        const baseUrl = llmConfig.baseUrl.replace(/\/$/, '');
        const provider = {
            async complete(system, user) {
                const res = await (0, node_fetch_1.default)(`${baseUrl}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${llmConfig.apiKey}`,
                    },
                    body: JSON.stringify({
                        model: llmConfig.model,
                        messages: [
                            { role: 'system', content: system },
                            { role: 'user', content: user },
                        ],
                        temperature: 0.3,
                        max_tokens: 1024,
                    }),
                });
                if (!res.ok)
                    throw new Error(`LLM API error: ${res.status} ${await res.text()}`);
                const data = (await res.json());
                return data.choices[0].message.content;
            },
        };
        // file 类型且为相对路径时，解析为 workDir 下的绝对路径
        const resolvedCollectConfig = {
            ...collectConfig,
            sources: collectConfig.sources.map((s) => s.type === 'file' && !path_1.default.isAbsolute(s.query)
                ? { ...s, query: path_1.default.join(workDir, s.query) }
                : s),
        };
        // L0.5: 自动加载 AGENTS.md 作为静态上下文
        // 读取工作目录下的 AGENTS.md（如果存在），并添加到 collect 源的前面
        const agentsMdPath = path_1.default.join(workDir, 'AGENTS.md');
        try {
            const fs = await Promise.resolve().then(() => __importStar(require('fs/promises')));
            await fs.readFile(agentsMdPath, 'utf-8');
            // 将 AGENTS.md 添加到 sources 的最前面，权重最高
            resolvedCollectConfig.sources = [
                { type: 'file', query: agentsMdPath, weight: 1.0 },
                ...resolvedCollectConfig.sources,
            ];
            console.log(`[L0.5] 自动加载 AGENTS.md: ${agentsMdPath}`);
        }
        catch {
            console.log(`[L0.5] AGENTS.md 不存在，跳过自动加载`);
        }
        const primitives = (0, primitives_1.createWorkDirPrimitives)(workDir);
        const llm = new index_1.LLMCall(provider);
        const trace = new index_1.Trace();
        const harness = new index_1.Harness(primitives, workDir);
        const state = (0, index_1.createInitialState)(goal, 2);
        if (subgoals.length > 0) {
            state.subgoals = subgoals;
            state.currentSubgoal = subgoals[0];
        }
        else {
            state.subgoals = [goal];
            state.currentSubgoal = goal;
        }
        const result = await (0, index_1.runLoop)(state, {
            collectConfig: resolvedCollectConfig,
            thresholds,
            workDir, // L0.4: 传递 workDir 用于 Execute 模式下的路径解析
            onEscalate: async (reason) => {
                // 仅记录，不阻断返回
                trace.append({ ts: Date.now(), kind: 'escalate', data: { reason } });
            },
            onStop: async () => { },
        }, primitives, llm, trace, harness);
        res.json({
            status: result.status,
            reason: 'reason' in result ? result.reason : undefined,
            state: serializeState(result.state),
            traceJson: trace.serialize(),
            traceLength: trace.all().length,
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
    }
});
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3889;
app.listen(PORT, () => {
    console.log(`Agent Runtime Core HTTP 服务: http://0.0.0.0:${PORT}`);
    console.log('  GET  /health  健康检查');
    console.log('  POST /run     执行 Agent 循环');
});
//# sourceMappingURL=index.js.map