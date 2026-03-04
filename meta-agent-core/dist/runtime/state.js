"use strict";
// [编排层 / 状态] runtime/state.ts — AgentState + StateManager（持久化）
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StateManager = exports.MODE_TRANSITIONS = void 0;
exports.canTransition = canTransition;
exports.createInitialState = createInitialState;
exports.generateSessionId = generateSessionId;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
// Mode 合法切换表
exports.MODE_TRANSITIONS = {
    plan: ['execute', 'recovery'],
    execute: ['review', 'recovery', 'plan'],
    review: ['execute', 'plan', 'recovery'],
    recovery: ['plan'],
    paused: ['plan', 'stop'], // stop 用字符串表示，由 Loop 处理
};
// 任意 mode → paused 都合法
function canTransition(from, to) {
    if (to === 'paused')
        return true; // 任何 mode → paused 合法
    const allowed = exports.MODE_TRANSITIONS[from];
    return allowed ? allowed.includes(to) : false;
}
/**
 * StateManager：Session 持久化与跨 Session 恢复
 */
class StateManager {
    /**
     * 加载 State
     * 读取 {agentDir}/state.json，不存在返回 null，解析失败也返回 null
     * 如果字段缺失，填充默认值
     */
    async load(agentDir) {
        const statePath = path_1.default.join(agentDir, 'state.json');
        try {
            const content = await promises_1.default.readFile(statePath, 'utf-8');
            const parsed = JSON.parse(content);
            // 填充缺失的字段（向后兼容）
            if (!parsed.sessionId) {
                // 旧版本没有 sessionId，生成一个新的
                parsed.sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            }
            if (!parsed.archivedSubgoals) {
                parsed.archivedSubgoals = [];
            }
            if (!parsed.completedToolCalls) {
                parsed.completedToolCalls = [];
            }
            if (!parsed.custom) {
                parsed.custom = {};
            }
            if (!parsed.environmentCapabilities) {
                parsed.environmentCapabilities = {
                    networkAvailable: false,
                    writePermission: true,
                    availableTools: ['read', 'write', 'edit', 'bash'],
                };
            }
            return parsed;
        }
        catch {
            return null;
        }
    }
    /**
     * 保存 State
     * 原子写入：先写 .tmp，再 rename 为 .json
     */
    async save(agentDir, state) {
        const statePath = path_1.default.join(agentDir, 'state.json');
        const tmpPath = statePath + '.tmp';
        try {
            await promises_1.default.mkdir(agentDir, { recursive: true });
            await promises_1.default.writeFile(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
            await promises_1.default.rename(tmpPath, statePath);
        }
        catch (error) {
            // 如果 rename 失败，尝试删除 tmp 文件
            try {
                await promises_1.default.unlink(tmpPath);
            }
            catch { }
            throw error;
        }
    }
    /**
     * 创建初始 State
     */
    createInitial(goal, permissions = 2) {
        // 生成 sessionId（使用时间戳 + 随机字符串）
        const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        return {
            sessionId,
            goal,
            subgoals: [],
            currentSubgoal: null,
            currentSubgoal_src: undefined,
            archivedSubgoals: [],
            completedToolCalls: [],
            mode: 'plan',
            permissions,
            iterationCount: 0,
            noProgressCount: 0,
            version: 0,
            environmentCapabilities: {
                networkAvailable: false,
                writePermission: true,
                availableTools: ['read', 'write', 'edit', 'bash'],
            },
            custom: {},
        };
    }
}
exports.StateManager = StateManager;
// 兼容调用方式
function createInitialState(goal, permissions = 2) {
    return new StateManager().createInitial(goal, permissions);
}
// 生成新的 sessionId
function generateSessionId() {
    return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
//# sourceMappingURL=state.js.map