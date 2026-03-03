"use strict";
// 对外入口 index.ts — 导出所有模块 + createMetaAgent 工厂
// 修改：统一 seq 序号空间、AGENT.md strategies 配置
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createErrorClassifier = exports.createPermissionHooks = exports.createModeHooks = exports.InterruptChannel = exports.StateManager = exports.createInitialState = exports.canTransition = exports.runLoop = exports.Harness = exports.Memory = exports.GlobalSeqManager = exports.TerminalLog = exports.Trace = exports.collect = exports.LLMCall = void 0;
exports.parseStrategiesConfig = parseStrategiesConfig;
exports.parseThresholdsConfig = parseThresholdsConfig;
exports.createMetaAgent = createMetaAgent;
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const primitives_1 = require("./core/primitives");
const llm_1 = require("./core/llm");
Object.defineProperty(exports, "LLMCall", { enumerable: true, get: function () { return llm_1.LLMCall; } });
const collect_1 = require("./core/collect");
Object.defineProperty(exports, "collect", { enumerable: true, get: function () { return collect_1.collect; } });
const trace_1 = require("./core/trace");
Object.defineProperty(exports, "Trace", { enumerable: true, get: function () { return trace_1.Trace; } });
Object.defineProperty(exports, "TerminalLog", { enumerable: true, get: function () { return trace_1.TerminalLog; } });
Object.defineProperty(exports, "GlobalSeqManager", { enumerable: true, get: function () { return trace_1.GlobalSeqManager; } });
const memory_1 = require("./core/memory");
Object.defineProperty(exports, "Memory", { enumerable: true, get: function () { return memory_1.Memory; } });
const harness_1 = require("./runtime/harness");
Object.defineProperty(exports, "Harness", { enumerable: true, get: function () { return harness_1.Harness; } });
const loop_1 = require("./runtime/loop");
Object.defineProperty(exports, "runLoop", { enumerable: true, get: function () { return loop_1.runLoop; } });
const state_1 = require("./runtime/state");
Object.defineProperty(exports, "StateManager", { enumerable: true, get: function () { return state_1.StateManager; } });
Object.defineProperty(exports, "canTransition", { enumerable: true, get: function () { return state_1.canTransition; } });
Object.defineProperty(exports, "createInitialState", { enumerable: true, get: function () { return state_1.createInitialState; } });
const interrupt_1 = require("./runtime/interrupt");
Object.defineProperty(exports, "InterruptChannel", { enumerable: true, get: function () { return interrupt_1.InterruptChannel; } });
const mode_state_machine_1 = require("./hooks/mode-state-machine");
Object.defineProperty(exports, "createModeHooks", { enumerable: true, get: function () { return mode_state_machine_1.createModeHooks; } });
const permission_guard_1 = require("./hooks/permission-guard");
Object.defineProperty(exports, "createPermissionHooks", { enumerable: true, get: function () { return permission_guard_1.createPermissionHooks; } });
const error_classifier_1 = require("./hooks/error-classifier");
Object.defineProperty(exports, "createErrorClassifier", { enumerable: true, get: function () { return error_classifier_1.createErrorClassifier; } });
/**
 * 从 AGENT.md 内容中解析策略层配置
 * 支持两种格式：
 * 1. ```json 代码块中的 JSON 格式
 * 2. YAML 格式（向后兼容）
 */
function parseStrategiesConfig(agentMdContent) {
    const defaultConfig = {
        level: 'L1',
        permissions: 2, // 默认权限级别：受控执行（常规 bash 命令）
        mode_fsm: 'enabled',
        permission_fsm: 'enabled',
        harness: 'standard',
        error_classifier: 'enabled',
        judge: {
            outcome: 'required',
            milestone: 'enabled',
            capability: 'enabled',
        },
    };
    if (!agentMdContent) {
        return defaultConfig;
    }
    // 优先尝试解析 ```json 代码块
    const jsonBlockMatch = agentMdContent.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonBlockMatch) {
        try {
            const parsed = JSON.parse(jsonBlockMatch[1]);
            // 合并配置
            const config = { ...defaultConfig };
            if (parsed.level)
                config.level = parsed.level;
            if (typeof parsed.permissions === 'number' && parsed.permissions >= 0 && parsed.permissions <= 4) {
                config.permissions = parsed.permissions;
            }
            if (parsed.mode_fsm)
                config.mode_fsm = parsed.mode_fsm;
            if (parsed.permission_fsm)
                config.permission_fsm = parsed.permission_fsm;
            if (parsed.harness)
                config.harness = parsed.harness;
            if (parsed.error_classifier)
                config.error_classifier = parsed.error_classifier;
            if (parsed.judge) {
                config.judge = { ...defaultConfig.judge, ...parsed.judge };
            }
            return config;
        }
        catch (e) {
            console.warn('Failed to parse JSON config block, falling back to YAML parsing:', e);
        }
    }
    // 解析 strategies 配置块（YAML 格式，向后兼容）
    const strategiesMatch = agentMdContent.match(/strategies:\s*([\s\S]*?)(?=\n\S|\n$|$)/i);
    if (!strategiesMatch) {
        return defaultConfig;
    }
    const strategiesContent = strategiesMatch[1];
    const config = { ...defaultConfig };
    // 解析 level
    const levelMatch = strategiesContent.match(/level:\s*(L\d+)/i);
    if (levelMatch) {
        config.level = levelMatch[1];
    }
    // 解析 permissions
    const permissionsMatch = strategiesContent.match(/permissions:\s*(\d+)/i);
    if (permissionsMatch) {
        const permLevel = parseInt(permissionsMatch[1], 10);
        if (permLevel >= 0 && permLevel <= 4) {
            config.permissions = permLevel;
        }
    }
    // 解析 mode_fsm
    const modeFsmMatch = strategiesContent.match(/mode_fsm:\s*(enabled|disabled)/i);
    if (modeFsmMatch) {
        config.mode_fsm = modeFsmMatch[1];
    }
    // 解析 permission_fsm
    const permFsmMatch = strategiesContent.match(/permission_fsm:\s*(enabled|disabled)/i);
    if (permFsmMatch) {
        config.permission_fsm = permFsmMatch[1];
    }
    // 解析 harness
    const harnessMatch = strategiesContent.match(/harness:\s*(standard|aggressive|disabled)/i);
    if (harnessMatch) {
        config.harness = harnessMatch[1];
    }
    // 解析 error_classifier
    const errorMatch = strategiesContent.match(/error_classifier:\s*(enabled|disabled)/i);
    if (errorMatch) {
        config.error_classifier = errorMatch[1];
    }
    // 解析 judge 配置块
    const judgeBlockMatch = strategiesContent.match(/judge:\s*([\s\S]*?)(?=\n\S|$)/i);
    if (judgeBlockMatch) {
        const judgeContent = judgeBlockMatch[1];
        const defaultJudge = {
            outcome: 'required',
            milestone: 'enabled',
            capability: 'enabled',
        };
        const outcomeMatch = judgeContent.match(/outcome:\s*(required|rule_based|disabled)/i);
        if (outcomeMatch)
            defaultJudge.outcome = outcomeMatch[1];
        const milestoneMatch = judgeContent.match(/milestone:\s*(enabled|disabled)/i);
        if (milestoneMatch)
            defaultJudge.milestone = milestoneMatch[1];
        const capabilityMatch = judgeContent.match(/capability:\s*(enabled|disabled)/i);
        if (capabilityMatch)
            defaultJudge.capability = capabilityMatch[1];
        config.judge = defaultJudge;
    }
    return config;
}
/**
 * 从 AGENT.md 内容中解析阈值配置
 * 支持从 ```json 代码块中解析 thresholds 字段
 */
function parseThresholdsConfig(agentMdContent) {
    if (!agentMdContent) {
        return undefined;
    }
    // 尝试解析 ```json 代码块
    const jsonBlockMatch = agentMdContent.match(/```json\s*([\s\S]*?)\s*```/);
    if (!jsonBlockMatch) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(jsonBlockMatch[1]);
        if (parsed.thresholds && typeof parsed.thresholds === 'object') {
            const thresholds = {};
            if (typeof parsed.thresholds.confidenceLow === 'number') {
                thresholds.confidenceLow = parsed.thresholds.confidenceLow;
            }
            if (typeof parsed.thresholds.confidenceMid === 'number') {
                thresholds.confidenceMid = parsed.thresholds.confidenceMid;
            }
            if (typeof parsed.thresholds.uncertaintyHigh === 'number') {
                thresholds.uncertaintyHigh = parsed.thresholds.uncertaintyHigh;
            }
            if (typeof parsed.thresholds.maxCollectRetry === 'number') {
                thresholds.maxCollectRetry = parsed.thresholds.maxCollectRetry;
            }
            if (typeof parsed.thresholds.maxNoProgress === 'number') {
                thresholds.maxNoProgress = parsed.thresholds.maxNoProgress;
            }
            if (typeof parsed.thresholds.maxIterations === 'number') {
                thresholds.maxIterations = parsed.thresholds.maxIterations;
            }
            // 返回非空对象
            return Object.keys(thresholds).length > 0 ? thresholds : undefined;
        }
        return undefined;
    }
    catch (e) {
        console.warn('Failed to parse thresholds config from AGENT.md:', e);
        return undefined;
    }
}
async function createMetaAgent(projectPath, goal, llmProvider, options) {
    // 1. 创建 .agent/ 目录
    const agentDir = path_1.default.join(projectPath, '.agent');
    await promises_1.default.mkdir(agentDir, { recursive: true });
    // 2. 解析 AGENT.md 中的策略层配置
    const strategiesConfig = parseStrategiesConfig(options?.agentMdContent);
    // 3. 初始化 Trace、TerminalLog 和 Memory
    // 遵循 agent-design-principles-v2.md 核心层 4：项目目录约定
    // 遵循 change.md 修改：terminal.log → terminal.md
    const traceLogPath = options?.logToFile ? path_1.default.join(agentDir, 'trace.jsonl') : undefined;
    const terminalLogPath = options?.logToFile ? path_1.default.join(agentDir, 'terminal.md') : undefined; // 改为 .md
    const memoryLogPath = options?.logToFile ? path_1.default.join(agentDir, 'memory.jsonl') : undefined;
    // 创建全局序号管理器（统一 seq 序号空间）
    const seqManager = new trace_1.GlobalSeqManager(traceLogPath);
    const trace = new trace_1.Trace(traceLogPath);
    trace.setSeqManager(seqManager); // 将 seqManager 注入到 Trace
    // 将 seqManager 注入到 TerminalLog
    const terminalLog = new trace_1.TerminalLog(traceLogPath, terminalLogPath, projectPath);
    terminalLog.setSeqManager(seqManager);
    const memory = new memory_1.Memory(memoryLogPath);
    // 4. 用 localPrimitives 创建原语
    // coreDir 为当前 SDK 的 src/ 目录绝对路径
    // 从 AGENT.md 解析截断配置
    const truncationConfig = (0, primitives_1.parseTruncationConfig)(options?.agentMdContent);
    const coreDir = path_1.default.resolve(__dirname, '..');
    // 传入 trace 实例，用于补齐 trace.jsonl 的 kind 字段
    const primitives = (0, primitives_1.localPrimitives)(coreDir, terminalLog, trace, truncationConfig);
    // 5. 用 StateManager 尝试恢复 State，失败则 createInitial
    const stateManager = new state_1.StateManager();
    let state = await stateManager.load(agentDir);
    const isResumed = state !== null;
    if (!state) {
        state = stateManager.createInitial(goal, options?.permissions ?? 2);
        if (options?.subgoals) {
            state.subgoals = options.subgoals;
            state.currentSubgoal = options.subgoals[0] ?? null;
        }
        await stateManager.save(agentDir, state);
    }
    else {
        // Session 恢复：加载累积的 Trace、TerminalLog 和 Memory
        // 这样可以继续之前的序列号，保证日志的连续性
        if (traceLogPath)
            await trace.loadFromFile();
        if (terminalLogPath)
            await terminalLog.loadFromFile();
        if (memoryLogPath)
            await memory.loadFromFile();
    }
    // 6. 根据 strategiesConfig 组合 hooks
    // 只有当对应策略 enabled 时才启用
    const standardHooks = {};
    // Mode 状态机
    if (strategiesConfig.mode_fsm === 'enabled') {
        Object.assign(standardHooks, (0, mode_state_machine_1.createModeHooks)(trace));
    }
    // 权限状态机
    if (strategiesConfig.permission_fsm === 'enabled') {
        Object.assign(standardHooks, (0, permission_guard_1.createPermissionHooks)());
    }
    // 错误分类
    if (strategiesConfig.error_classifier === 'enabled') {
        Object.assign(standardHooks, (0, error_classifier_1.createErrorClassifier)());
    }
    // options.hooks 优先级高于标准 hooks
    const mergedHooks = {
        ...standardHooks,
        ...options?.hooks,
        // 合并嵌套的 hook 函数
        onModeTransition: options?.hooks?.onModeTransition ?? standardHooks.onModeTransition,
        onBeforeExec: options?.hooks?.onBeforeExec ?? standardHooks.onBeforeExec,
        onAfterObserve: options?.hooks?.onAfterObserve ?? standardHooks.onAfterObserve,
        shouldSnapshot: options?.hooks?.shouldSnapshot ?? standardHooks.shouldSnapshot,
        classifyError: options?.hooks?.classifyError ?? standardHooks.classifyError,
        onInterrupt: options?.hooks?.onInterrupt ?? standardHooks.onInterrupt,
    };
    // 7. 创建 LLMCall 实例
    const llm = new llm_1.LLMCall(llmProvider);
    // 设置静态上下文（AGENT.md 内容）
    if (options?.agentMdContent) {
        llm.setStaticContext(options.agentMdContent);
    }
    // 8. 创建 Harness 和 InterruptChannel
    const harness = new harness_1.Harness(primitives, projectPath, agentDir);
    const interrupt = new interrupt_1.InterruptChannel();
    // 9. 构建 LoopDeps
    const deps = {
        primitives,
        llm,
        trace,
        terminalLog,
        memory,
        harness,
        interrupt,
        stateManager,
        agentDir,
        skillsDir: options?.skillsDir, // 传递 skills 目录路径
    };
    // 10. 返回 MetaAgent 对象
    return {
        run: async (loopConfig) => {
            const fullConfig = {
                collectConfig: options?.collectConfig ?? { sources: [] },
                ...loopConfig,
            };
            return (0, loop_1.runLoop)(state, fullConfig, deps, mergedHooks);
        },
        interrupt: (message) => {
            interrupt.push({ message, ts: Date.now() });
        },
        getState: () => state,
        getTrace: () => trace,
        getTerminalLog: () => terminalLog,
        getMemory: () => memory,
    };
}
//# sourceMappingURL=index.js.map