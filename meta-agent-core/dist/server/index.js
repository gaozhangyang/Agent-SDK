"use strict";
/**
 * Meta Agent Core HTTP 服务
 * 内部 import SDK，对外暴露 HTTP 接口，供 Python 等客户端调用
 * 基于 agent-runtime-core 的 /run 接口设计
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
const app = (0, express_1.default)();
app.use(express_1.default.json({ limit: '2mb' }));
// 全局 Agent 缓存，按 workDir 索引，实现跨请求的 Session 恢复
const agentCache = new Map();
const agentConfigCache = new Map();
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
    res.json({ status: 'ok', service: 'meta-agent-core' });
});
/**
 * POST /run
 * 执行一次 Agent 循环，返回 status、state 摘要、trace 序列化
 * 支持跨请求恢复 Session（通过缓存 agent 实例）
 */
app.post('/run', async (req, res) => {
    try {
        const body = req.body;
        const { goal, subgoals = [], workDir, collectConfig, llm: llmConfig, thresholds, debug = false, resume = true } = body;
        if (!goal || typeof workDir !== 'string') {
            res.status(400).json({ error: '缺少 goal 或 workDir' });
            return;
        }
        if (!collectConfig?.sources?.length) {
            res.status(400).json({ error: 'collectConfig.sources 不能为空' });
            return;
        }
        if (!llmConfig?.baseUrl || !llmConfig?.model) {
            // apiKey 可以为空字符串（部分 LLM 服务不需要）
            res.status(400).json({ error: 'llm 需提供 baseUrl、model' });
            return;
        }
        // Debug: 打印请求信息
        if (debug) {
            console.log('[DEBUG] Received run request:', {
                goal: goal.substring(0, 100),
                workDir,
                sources: collectConfig.sources?.map((s) => s.query) || [],
                debug,
                resume,
            });
        }
        // 使用 workDir 作为缓存键
        const cacheKey = workDir;
        // 决定是否使用缓存的 agent
        let agent;
        let isResumed = false;
        if (resume && agentCache.has(cacheKey)) {
            // 恢复之前的 Session
            agent = agentCache.get(cacheKey);
            isResumed = true;
            if (debug) {
                console.log('[DEBUG] Resuming previous session for:', cacheKey);
            }
        }
        else {
            // 创建新的 agent 实例
            // 如果 resume=false，先清除旧的 state.json（强制使用新的 goal）
            if (!resume) {
                const fs = await Promise.resolve().then(() => __importStar(require('fs/promises')));
                const oldStatePath = path_1.default.join(workDir, '.agent', 'state.json');
                try {
                    await fs.unlink(oldStatePath);
                    if (debug) {
                        console.log('[DEBUG] Cleared old state for fresh start');
                    }
                }
                catch {
                    // 文件不存在，忽略
                }
            }
            const baseUrl = llmConfig.baseUrl.replace(/\/$/, '');
            const provider = {
                async complete(system, user) {
                    const res = await (0, node_fetch_1.default)(`${baseUrl}/chat/completions`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: llmConfig.apiKey ? `Bearer ${llmConfig.apiKey}` : '',
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
                sources: (collectConfig.sources || []).map((s) => s.type === 'file' && !path_1.default.isAbsolute(s.query)
                    ? { ...s, query: path_1.default.join(workDir, s.query) }
                    : s),
            };
            // L0.5: 自动加载 AGENT.md 作为静态上下文
            // 读取工作目录下的 .agent/AGENT.md（如果存在），并注入到 LLMCall
            // 遵循 agent-design-principles-merged.md 核心层 3：静态上下文注入
            // 注意：根据 change.md 修改，AGENT.md 已移至 .agent/ 目录
            const agentMdPath = path_1.default.join(workDir, '.agent', 'AGENT.md');
            let agentMdContent;
            try {
                const fs = await Promise.resolve().then(() => __importStar(require('fs/promises')));
                agentMdContent = await fs.readFile(agentMdPath, 'utf-8');
                console.log(`[L0.5] 自动加载 AGENT.md: ${agentMdPath}`);
            }
            catch {
                console.log(`[L0.5] AGENT.md 不存在，跳过自动加载`);
            }
            // 从 AGENT.md 解析策略层配置（包括 permissions）
            const strategiesConfig = (0, index_1.parseStrategiesConfig)(agentMdContent);
            const permissions = strategiesConfig.permissions ?? 3; // 默认权限级别 3（高风险执行，支持网络访问）
            // 查找 skills 目录
            const skillsDir = path_1.default.join(workDir, 'skills');
            // 使用 createMetaAgent 创建 agent
            agent = await (0, index_1.createMetaAgent)(workDir, goal, provider, {
                permissions, // 从 AGENT.md 的运行时配置读取权限级别
                subgoals: subgoals.length > 0 ? subgoals : [goal],
                logToFile: true, // 始终保存 Trace、Terminal Log、Memory 到 .agent/ 目录
                collectConfig: resolvedCollectConfig,
                agentMdContent, // 传递 AGENT.md 内容作为静态上下文
                skillsDir, // 传递 skills 目录路径
            });
            // 缓存 agent 实例
            agentCache.set(cacheKey, agent);
            agentConfigCache.set(cacheKey, { llmConfig, collectConfig: resolvedCollectConfig, agentMdContent });
        }
        // 获取当前收集配置（用于恢复的 agent）
        const currentCollectConfig = agentConfigCache.get(cacheKey)?.collectConfig || collectConfig;
        // 从 AGENT.md 解析阈值配置
        const agentMdContent = agentConfigCache.get(cacheKey)?.agentMdContent;
        const agentThresholds = (0, index_1.parseThresholdsConfig)(agentMdContent);
        // 合并阈值配置：请求中的阈值优先级高于 AGENT.md 中的阈值
        const mergedThresholds = { ...agentThresholds, ...thresholds };
        const result = await agent.run({
            collectConfig: currentCollectConfig,
            thresholds: mergedThresholds,
            onEscalate: async (reason) => {
                // 仅记录，不阻断返回
                const trace = agent.getTrace();
                trace.append({ ts: Date.now(), kind: 'escalate', data: { reason } });
            },
            onStop: async () => { },
        });
        const trace = agent.getTrace();
        const terminalLog = agent.getTerminalLog();
        const memory = agent.getMemory();
        res.json({
            status: result.status,
            reason: result.status === 'escalated' && 'reason' in result ? result.reason : (result.status === 'budget_exceeded' ? 'budget_exceeded: 迭代次数超出限制' : undefined),
            state: serializeState(result.state),
            traceJson: trace.serialize(),
            traceLength: trace.all().length,
            terminalLogLength: terminalLog.all().length,
            memoryLength: memory.size(),
            isResumed,
            debug: debug ? {
                iterations: result.state.iterationCount,
                mode: result.state.mode,
                subgoalsRemaining: result.state.subgoals.length,
            } : undefined,
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : '';
        console.error('[SDK Error]', message, stack);
        res.status(500).json({ status: 'error', reason: message });
    }
});
/**
 * GET /agent/:workDir
 * 获取缓存的 agent 状态
 */
app.get('/agent/:workDir', async (req, res) => {
    const { workDir } = req.params;
    const cacheKey = workDir;
    if (!agentCache.has(cacheKey)) {
        res.status(404).json({ error: 'Agent not found', workDir });
        return;
    }
    const agent = agentCache.get(cacheKey);
    const state = agent.getState();
    const trace = agent.getTrace();
    const terminalLog = agent.getTerminalLog();
    const memory = agent.getMemory();
    res.json({
        workDir,
        state: serializeState(state),
        traceLength: trace.all().length,
        terminalLogLength: terminalLog.all().length,
        memoryLength: memory.size(),
    });
});
/**
 * DELETE /agent/:workDir
 * 清除缓存的 agent（结束 Session）
 */
app.delete('/agent/:workDir', async (req, res) => {
    const { workDir } = req.params;
    const cacheKey = workDir;
    if (!agentCache.has(cacheKey)) {
        res.status(404).json({ error: 'Agent not found', workDir });
        return;
    }
    agentCache.delete(cacheKey);
    agentConfigCache.delete(cacheKey);
    res.json({ ok: true, workDir, message: 'Agent cache cleared' });
});
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3890;
app.listen(PORT, () => {
    console.log(`Meta Agent Core HTTP 服务: http://0.0.0.0:${PORT}`);
    console.log('  GET  /health              健康检查');
    console.log('  POST /run                 执行 Agent 循环（自动恢复 Session）');
    console.log('  GET  /agent/:workDir      获取 agent 状态');
    console.log('  DELETE /agent/:workDir   清除 agent 缓存');
});
//# sourceMappingURL=index.js.map