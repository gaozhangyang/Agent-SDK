"use strict";
/**
 * L1.1 + L1.2 — State 结构体（权限 + Mode）
 *
 * 权限状态机：存储在 State.permissions，分五级
 * Mode 状态机：存储在 State.mode，每次切换记录到 Trace
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MODE_TRANSITIONS = void 0;
exports.createInitialState = createInitialState;
exports.canTransition = canTransition;
exports.getValidTransitions = getValidTransitions;
/**
 * 创建初始状态
 */
function createInitialState(goal, permissions = 2) {
    return {
        goal,
        subgoals: [],
        currentSubgoal: null,
        mode: 'plan',
        permissions,
        iterationCount: 0,
        noProgressCount: 0,
        version: 0,
        custom: {},
    };
}
// Mode 合法切换表（L1.2 切换规则）
exports.MODE_TRANSITIONS = {
    plan: ['execute', 'recovery'],
    execute: ['review', 'recovery', 'plan'],
    review: ['execute', 'plan', 'recovery'],
    recovery: ['plan'],
};
/**
 * 检查 Mode 是否可以切换
 */
function canTransition(from, to) {
    return exports.MODE_TRANSITIONS[from].includes(to);
}
/**
 * 获取所有合法的切换目标
 */
function getValidTransitions(from) {
    return exports.MODE_TRANSITIONS[from];
}
//# sourceMappingURL=state.js.map