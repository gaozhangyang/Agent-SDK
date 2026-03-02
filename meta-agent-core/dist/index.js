"use strict";
// 对外入口 index.ts — 导出所有模块 + createMetaAgent 工厂
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createErrorClassifier = exports.createPermissionHooks = exports.createModeHooks = exports.InterruptChannel = exports.StateManager = exports.createInitialState = exports.canTransition = exports.runLoop = exports.Harness = exports.Memory = exports.TerminalLog = exports.Trace = exports.collect = exports.LLMCall = void 0;
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
async function createMetaAgent(projectPath, goal, llmProvider, options) {
    // 1. 创建 .agent/ 目录
    const agentDir = path_1.default.join(projectPath, '.agent');
    await promises_1.default.mkdir(agentDir, { recursive: true });
    // 2. 初始化 Trace、TerminalLog 和 Memory
    const traceLogPath = options?.logToFile ? path_1.default.join(agentDir, 'trace.jsonl') : undefined;
    const terminalLogPath = options?.logToFile ? path_1.default.join(agentDir, 'terminal.jsonl') : undefined;
    const memoryLogPath = options?.logToFile ? path_1.default.join(agentDir, 'memory.jsonl') : undefined;
    const trace = new trace_1.Trace(traceLogPath);
    const terminalLog = new trace_1.TerminalLog(terminalLogPath);
    const memory = new memory_1.Memory(memoryLogPath);
    // 3. 用 localPrimitives 创建原语
    // coreDir 为当前 SDK 的 src/ 目录绝对路径
    const coreDir = path_1.default.resolve(__dirname, '..');
    const primitives = (0, primitives_1.localPrimitives)(coreDir, terminalLog);
    // 4. 用 StateManager 尝试恢复 State，失败则 createInitial
    const stateManager = new state_1.StateManager();
    let state = await stateManager.load(agentDir);
    if (!state) {
        state = stateManager.createInitial(goal, options?.permissions ?? 2);
        if (options?.subgoals) {
            state.subgoals = options.subgoals;
            state.currentSubgoal = options.subgoals[0] ?? null;
        }
        await stateManager.save(agentDir, state);
    }
    // 5. 组合标准 hooks：createModeHooks() + createPermissionHooks() + createErrorClassifier()
    // options.hooks 优先级高于标准 hooks
    const standardHooks = {
        ...(0, mode_state_machine_1.createModeHooks)(trace),
        ...(0, permission_guard_1.createPermissionHooks)(),
        ...(0, error_classifier_1.createErrorClassifier)(),
    };
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
    // 6. 创建 LLMCall 实例
    const llm = new llm_1.LLMCall(llmProvider);
    // 7. 创建 Harness 和 InterruptChannel
    const harness = new harness_1.Harness(primitives, projectPath, agentDir);
    const interrupt = new interrupt_1.InterruptChannel();
    // 8. 构建 LoopDeps
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
    };
    // 9. 返回 MetaAgent 对象
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