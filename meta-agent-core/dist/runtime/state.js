"use strict";
// [编排层 / 状态] runtime/state.ts — AgentState + StateManager（持久化）
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StateManager = exports.MODE_TRANSITIONS = void 0;
exports.canTransition = canTransition;
exports.createInitialState = createInitialState;
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
     */
    async load(agentDir) {
        const statePath = path_1.default.join(agentDir, 'state.json');
        try {
            const content = await promises_1.default.readFile(statePath, 'utf-8');
            return JSON.parse(content);
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
        return {
            goal,
            subgoals: [],
            currentSubgoal: null,
            archivedSubgoals: [],
            mode: 'plan',
            permissions,
            iterationCount: 0,
            noProgressCount: 0,
            version: 0,
            custom: {},
        };
    }
}
exports.StateManager = StateManager;
// 兼容 v1 的调用方式
function createInitialState(goal, permissions = 2) {
    return new StateManager().createInitial(goal, permissions);
}
//# sourceMappingURL=state.js.map