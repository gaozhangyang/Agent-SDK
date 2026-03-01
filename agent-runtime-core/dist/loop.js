"use strict";
/**
 * L0.4 + L1.1 + L1.2 — 核心执行循环
 *
 * 包含权限状态机（L1.1）和 Role/Mode 状态机（L1.2）
 * 终止条件是一等概念
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.runLoop = runLoop;
const collect_1 = require("./collect");
const state_1 = require("./state");
// 阈值常量（可由调用方覆盖）
const DEFAULT_THRESHOLDS = {
    confidenceLow: 0.2, // 低于此值直接 Escalate
    confidenceMid: 0.5, // 低于此值触发补采集
    uncertaintyHigh: 0.75, // 高于此值触发多候选或 Escalate
    maxCollectRetry: 3, // 最大补采集重试次数
    maxNoProgress: 3, // 连续无增益上限
    maxIterations: 50, // 最大迭代次数（token/时间预算）
};
/**
 * 核心执行循环
 *
 * @param state - 初始状态
 * @param config - 循环配置
 * @param primitives - 执行原语
 * @param llm - LLM 调用
 * @param trace - 追踪系统
 * @param harness - 版本快照
 */
async function runLoop(state, config, primitives, llm, trace, harness) {
    const t = { ...DEFAULT_THRESHOLDS, ...config.thresholds };
    while (true) {
        state.iterationCount++;
        // ── 终止条件检查（一等概念）──────────────────────────────
        // 1. 超出最大迭代次数
        if (state.iterationCount > t.maxIterations) {
            trace.append({ ts: Date.now(), kind: 'stop', data: { reason: 'budget_exceeded' } });
            await config.onStop?.(state);
            return { status: 'budget_exceeded', state };
        }
        // 2. 连续无增益超出上限
        if (state.noProgressCount >= t.maxNoProgress) {
            const reason = '连续无增益，超出上限';
            trace.append({ ts: Date.now(), kind: 'escalate', data: { reason } });
            await config.onEscalate?.(reason, state);
            return { status: 'escalated', reason, state };
        }
        // 3. 目标已完成（没有当前子目标且没有剩余子目标）
        if (!state.currentSubgoal && state.subgoals.length === 0) {
            trace.append({ ts: Date.now(), kind: 'stop', data: { reason: 'goal_completed' } });
            await config.onStop?.(state);
            return { status: 'completed', state };
        }
        // ── Step 1: Collect ────────────────────────────────────
        let collectResult = await (0, collect_1.collect)(config.collectConfig, primitives, (tag) => trace.filterByTag(tag));
        trace.append({
            ts: Date.now(), kind: 'collect',
            data: { sources: config.collectConfig.sources.map(s => s.query) },
            confidence: collectResult.confidence,
        });
        // 补采集循环（coverage 低，reliability 高）
        let collectRetry = 0;
        while (collectResult.confidence.coverage < t.confidenceMid &&
            collectResult.confidence.reliability >= t.confidenceMid &&
            collectRetry < t.maxCollectRetry) {
            collectRetry++;
            collectResult = await (0, collect_1.collect)(config.collectConfig, primitives, (tag) => trace.filterByTag(tag));
            trace.append({
                ts: Date.now(), kind: 'collect',
                data: { retry: collectRetry },
                confidence: collectResult.confidence,
            });
        }
        // 置信度太低 → Escalate
        if (collectResult.confidence.coverage < t.confidenceLow ||
            collectResult.confidence.reliability < t.confidenceLow) {
            const reason = `置信度不足: coverage=${collectResult.confidence.coverage.toFixed(2)}, reliability=${collectResult.confidence.reliability.toFixed(2)}`;
            trace.append({ ts: Date.now(), kind: 'escalate', data: { reason }, confidence: collectResult.confidence });
            await config.onEscalate?.(reason, state);
            return { status: 'escalated', reason, state };
        }
        // ── Step 2: Plan 模式下执行 Reason ──────────────────────
        if (state.mode === 'plan') {
            const taskDesc = state.currentSubgoal ?? state.goal;
            const reasonResult = await llm.reason(collectResult.context, taskDesc);
            // 质量信号统一写入 Trace（原则：confidence/uncertainty 只写一次）
            const uncertainty = reasonResult.uncertainty ?? { score: 0.5, reasons: [] };
            trace.append({
                ts: Date.now(), kind: 'reason',
                data: { task: taskDesc, result: reasonResult.result },
                uncertainty,
            });
            if (uncertainty.score > t.uncertaintyHigh) {
                // 不确定性高 → 多候选
                const multi = await llm.reasonMulti(collectResult.context, taskDesc);
                trace.append({
                    ts: Date.now(), kind: 'reason',
                    data: { multi: true, candidates: multi.candidates },
                    uncertainty: multi.uncertainty,
                });
                if (multi.uncertainty.score > t.uncertaintyHigh) {
                    const reason = `Reason 不确定性过高: ${multi.uncertainty.score.toFixed(2)}`;
                    trace.append({ ts: Date.now(), kind: 'escalate', data: { reason } });
                    await config.onEscalate?.(reason, state);
                    return { status: 'escalated', reason, state };
                }
                // 多候选 → Judge(selection) 仲裁
                const selResult = await llm.judge('selection', collectResult.context, JSON.stringify(multi.candidates));
                trace.append({ ts: Date.now(), kind: 'judge', data: { type: 'selection', decision: selResult.result }, uncertainty: selResult.uncertainty });
                state.custom['pendingProposal'] = selResult.result;
            }
            else {
                state.custom['pendingProposal'] = reasonResult.result;
            }
            // Plan → Execute（需 Judge(risk) 通过）
            const riskResult = await llm.judge('risk', collectResult.context, String(state.custom['pendingProposal']));
            trace.append({ ts: Date.now(), kind: 'judge', data: { type: 'risk', decision: riskResult.result }, uncertainty: riskResult.uncertainty });
            // 需要同时检查中英文关键词，并检查是否明确拒绝
            const riskApproved = riskResult.result.toLowerCase().includes('通过') ||
                riskResult.result.toLowerCase().includes('pass') ||
                riskResult.result.toLowerCase().includes('approved') ||
                riskResult.result.toLowerCase().includes('允许') ||
                riskResult.result.toLowerCase().includes('同意');
            // 检查是否明确拒绝
            const riskRejected = riskResult.result.toLowerCase().includes('拒绝') ||
                riskResult.result.toLowerCase().includes('reject') ||
                riskResult.result.toLowerCase().includes('deny') ||
                riskResult.result.toLowerCase().includes('不允许') ||
                riskResult.result.toLowerCase().includes('不同意');
            if (riskRejected || (!riskApproved && riskResult.uncertainty.score > t.uncertaintyHigh)) {
                const reason = riskRejected
                    ? `Judge(risk) 拒绝: ${riskResult.result.slice(0, 200)}`
                    : `Judge(risk) 不确定性过高: ${riskResult.result.slice(0, 200)}`;
                trace.append({ ts: Date.now(), kind: 'escalate', data: { reason } });
                await config.onEscalate?.(reason, state);
                return { status: 'escalated', reason, state };
            }
            // 切换到 Execute（必须校验）
            if ((0, state_1.canTransition)(state.mode, 'execute')) {
                state.mode = 'execute';
                state.version++;
                trace.append({ ts: Date.now(), kind: 'state', data: { modeTransition: 'plan→execute' } });
            }
            continue;
        }
        // ── Step 4: Execute 模式 ────────────────────────────────
        if (state.mode === 'execute') {
            const proposal = String(state.custom['pendingProposal'] ?? '');
            // Harness 自动快照（只对有副作用操作）
            const snapshotOk = await harness.snapshot(`iter-${state.iterationCount}`);
            if (!snapshotOk) {
                // 快照失败默认阻断（L0.6）
                trace.append({ ts: Date.now(), kind: 'escalate', data: { reason: '快照失败，阻断执行' } });
                await config.onEscalate?.('快照失败', state);
                return { status: 'escalated', reason: '快照失败', state };
            }
            // 执行动作：解析 proposal 并调用实际工具
            // L0.4: "执行工具 [harness 自动快照]"
            try {
                await executeProposal(proposal, primitives, state, trace, config.workDir);
            }
            catch (execError) {
                const errorMsg = execError instanceof Error ? execError.message : String(execError);
                trace.append({ ts: Date.now(), kind: 'exec', data: { proposal, error: errorMsg } });
                // 执行失败进入 Recovery
                if ((0, state_1.canTransition)(state.mode, 'recovery')) {
                    state.mode = 'recovery';
                    state.version++;
                    trace.append({ ts: Date.now(), kind: 'state', data: { modeTransition: 'execute→recovery', reason: '执行失败' } });
                }
                continue;
            }
            trace.append({ ts: Date.now(), kind: 'exec', data: { proposal } });
            // Execute → Review（必须校验）
            if ((0, state_1.canTransition)(state.mode, 'review')) {
                state.mode = 'review';
                state.version++;
                trace.append({ ts: Date.now(), kind: 'state', data: { modeTransition: 'execute→review' } });
            }
            continue;
        }
        // ── Step 5+6: Review 模式 ───────────────────────────────
        if (state.mode === 'review') {
            const outcomeResult = await llm.judge('outcome', collectResult.context, `目标: ${state.currentSubgoal ?? state.goal}\n执行提案: ${state.custom['pendingProposal']}`);
            trace.append({
                ts: Date.now(), kind: 'judge',
                data: { type: 'outcome', decision: outcomeResult.result },
                uncertainty: outcomeResult.uncertainty,
            });
            // 需要同时检查中英文关键词
            const achieved = outcomeResult.result.toLowerCase().includes('达成') ||
                outcomeResult.result.toLowerCase().includes('pass') ||
                outcomeResult.result.toLowerCase().includes('achieved') ||
                outcomeResult.result.toLowerCase().includes('yes');
            if (!achieved || outcomeResult.uncertainty.score > t.uncertaintyHigh) {
                state.noProgressCount++;
                // 进入 Recovery 或重新 Plan
                if (state.noProgressCount >= t.maxNoProgress)
                    continue; // 下次迭代触发 Escalate
                if ((0, state_1.canTransition)(state.mode, 'recovery')) {
                    state.mode = 'recovery';
                    state.version++;
                    trace.append({ ts: Date.now(), kind: 'state', data: { modeTransition: 'review→recovery' } });
                }
                continue;
            }
            // 子目标完成
            state.noProgressCount = 0;
            if (state.currentSubgoal) {
                state.subgoals = state.subgoals.filter(g => g !== state.currentSubgoal);
                state.currentSubgoal = state.subgoals[0] ?? null;
            }
            // 仍有子目标 → 回 Plan
            if (state.subgoals.length > 0) {
                state.currentSubgoal = state.subgoals[0] ?? null;
                if ((0, state_1.canTransition)(state.mode, 'plan')) {
                    state.mode = 'plan';
                    state.version++;
                    trace.append({ ts: Date.now(), kind: 'state', data: { modeTransition: 'review→plan' } });
                }
            }
            // 否则下次迭代检测到 goal_completed → Stop
            continue;
        }
        // ── Recovery 模式 ───────────────────────────────────────
        if (state.mode === 'recovery') {
            trace.append({ ts: Date.now(), kind: 'state', data: { mode: 'recovery', action: '诊断与回退' } });
            // 只允许 bash(git) 和 read（L1.2），实际回退由 harness 执行
            await harness.rollback();
            if ((0, state_1.canTransition)(state.mode, 'plan')) {
                state.mode = 'plan';
                state.version++;
                state.custom['pendingProposal'] = null;
                trace.append({ ts: Date.now(), kind: 'state', data: { modeTransition: 'recovery→plan' } });
            }
        }
    }
}
/**
 * 执行提案 - 解析并执行工具调用
 *
 * L0.4: "执行工具" - Execute 模式下实际执行 write/edit/bash 操作
 * L1.1: 权限检查 - 根据 permissions 限制可执行的操作
 */
async function executeProposal(proposal, primitives, state, trace, workDir) {
    // 导入 path 模块用于路径处理
    const pathModule = await Promise.resolve().then(() => __importStar(require('path')));
    // 尝试解析 JSON 格式的提案
    let actions = [];
    try {
        // 尝试解析 JSON
        const parsed = JSON.parse(proposal);
        if (Array.isArray(parsed)) {
            actions = parsed;
        }
        else if (typeof parsed === 'object' && parsed !== null) {
            actions = [parsed];
        }
        else {
            // 如果不是结构化数据，尝试解析为自然语言指令
            actions = parseNaturalLanguageProposal(proposal);
        }
    }
    catch {
        // JSON 解析失败，尝试自然语言解析
        actions = parseNaturalLanguageProposal(proposal);
    }
    // 执行每个动作
    for (const action of actions) {
        switch (action.type) {
            case 'write':
                // 需要至少 Level 1 权限（受控写）
                if (state.permissions < 1) {
                    throw new Error(`权限不足：需要 Level 1（受控写），当前 ${state.permissions}`);
                }
                if (!action.path || !action.content) {
                    throw new Error('write 操作需要 path 和 content');
                }
                // 解析相对路径为绝对路径
                const writePath = workDir && !pathModule.isAbsolute(action.path)
                    ? pathModule.join(workDir, action.path)
                    : action.path;
                // 对于survey_output.md，使用追加模式并添加时间戳和步骤标记
                const isSurveyOutput = action.path.includes('survey_output');
                let writeContent = action.content;
                if (isSurveyOutput) {
                    // 获取当前步骤编号
                    const stepNum = state.iterationCount;
                    const timestamp = new Date().toISOString();
                    writeContent = `[step${stepNum}] ${timestamp}\n$ ${action.content.trim()}`;
                }
                await primitives.write(writePath, writeContent, isSurveyOutput);
                trace.append({ ts: Date.now(), kind: 'observe', data: { action: 'write', path: writePath } });
                break;
            case 'edit':
                // 需要至少 Level 1 权限（受控写）
                if (state.permissions < 1) {
                    throw new Error(`权限不足：需要 Level 1（受控写），当前 ${state.permissions}`);
                }
                if (!action.path || !action.content) {
                    throw new Error('edit 操作需要 path 和 content (包含 old/new)');
                }
                const editParts = action.content.split('|||');
                if (editParts.length !== 2) {
                    throw new Error('edit content 格式：old|||new');
                }
                // 解析相对路径为绝对路径
                const editPath = workDir && !pathModule.isAbsolute(action.path)
                    ? pathModule.join(workDir, action.path)
                    : action.path;
                await primitives.edit(editPath, editParts[0], editParts[1]);
                trace.append({ ts: Date.now(), kind: 'observe', data: { action: 'edit', path: editPath } });
                break;
            case 'bash':
                // 需要至少 Level 2 权限（受控执行）
                if (state.permissions < 2) {
                    throw new Error(`权限不足：需要 Level 2（受控执行），当前 ${state.permissions}`);
                }
                if (!action.command) {
                    throw new Error('bash 操作需要 command');
                }
                // 高风险命令需要 Level 3
                if (isHighRiskCommand(action.command) && state.permissions < 3) {
                    throw new Error(`权限不足：高风险命令需要 Level 3，当前 ${state.permissions}`);
                }
                const output = await primitives.bash(action.command);
                trace.append({ ts: Date.now(), kind: 'observe', data: { action: 'bash', command: action.command, output: output.slice(0, 200) } });
                break;
            case 'read':
                // 只读操作需要 Level 0
                if (!action.path) {
                    throw new Error('read 操作需要 path');
                }
                // 解析相对路径为绝对路径
                const readPath = workDir && !pathModule.isAbsolute(action.path)
                    ? pathModule.join(workDir, action.path)
                    : action.path;
                const content = await primitives.read(readPath);
                trace.append({ ts: Date.now(), kind: 'observe', data: { action: 'read', path: readPath, length: content.length } });
                break;
            default:
                // 未知动作类型，跳过
                trace.append({ ts: Date.now(), kind: 'observe', data: { action: 'unknown', raw: action } });
        }
    }
}
/**
 * 解析自然语言提案为可执行动作
 * 简单的启发式解析，实际可以使用 LLM 来解析
 */
function parseNaturalLanguageProposal(proposal) {
    const actions = [];
    // 匹配 "写文件 X 内容 Y" 或 "写入 X: Y" 模式
    const writeMatch = proposal.match(/(?:写|写入|write)[:\s]+([^\s]+)[:\s]+(.+)/i);
    if (writeMatch) {
        actions.push({ type: 'write', path: writeMatch[1], content: writeMatch[2] });
        return actions;
    }
    // 匹配 "执行命令 X" 或 "运行 X" 模式
    const bashMatch = proposal.match(/(?:执行|运行|execute|run)[:\s]+(.+)/i);
    if (bashMatch) {
        actions.push({ type: 'bash', command: bashMatch[1] });
        return actions;
    }
    // 如果无法解析，返回一个默认的 write 动作
    // 假设提案本身就包含了要写入的内容
    if (proposal.length > 50) {
        // 默认写入到 survey_output.md
        actions.push({ type: 'write', path: 'survey_output.md', content: proposal });
    }
    return actions;
}
/**
 * 检查是否为高风险命令
 * L1.1: 高风险执行需要 Level 3 权限
 */
function isHighRiskCommand(command) {
    const highRiskPatterns = [
        /rm\s+-rf/i,
        /del\s+\/[sfq]/i,
        /mkfs/i,
        /dd\s+if=/i,
        />\s*\/dev\/sd/i,
        /curl.*\|\s*sh/i,
        /wget.*\|\s*sh/i,
        /shutdown/i,
        /reboot/i,
        /chmod\s+777/i,
        /chown\s+-R/i,
    ];
    return highRiskPatterns.some(pattern => pattern.test(command));
}
//# sourceMappingURL=loop.js.map