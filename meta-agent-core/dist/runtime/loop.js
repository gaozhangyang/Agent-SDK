"use strict";
// [编排层 / 循环] runtime/loop.ts — Loop 骨架 + LoopHooks 接口 + 终止条件
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_THRESHOLDS = void 0;
exports.runLoop = runLoop;
const collect_1 = require("../core/collect");
const state_1 = require("./state");
// 默认阈值（与 v1 完全相同）
exports.DEFAULT_THRESHOLDS = {
    confidenceLow: 0.3,
    confidenceMid: 0.6,
    uncertaintyHigh: 0.7,
    maxCollectRetry: 3,
    maxNoProgress: 3,
    maxIterations: 50,
};
/**
 * 运行 Agent 循环
 * 必须严格按 Loop 顺序执行
 */
async function runLoop(state, config, deps, hooks) {
    const t = { ...exports.DEFAULT_THRESHOLDS, ...config.thresholds };
    while (true) {
        state.iterationCount++;
        // ── 1. [Interrupt 检查] poll() → 有信号时进入 Paused 处理 ─────────────
        const interruptSignal = deps.interrupt.poll();
        if (interruptSignal) {
            // 先快照保护现场
            await deps.harness.snapshot(`interrupt-iter-${state.iterationCount}`);
            // 切换到 Paused
            if ((0, state_1.canTransition)(state.mode, 'paused')) {
                state.mode = 'paused';
                state.version++;
                deps.trace.append({
                    ts: Date.now(),
                    kind: 'interrupt',
                    data: { userMessage: interruptSignal.message },
                });
            }
            // 处理用户指令
            const directive = hooks?.onInterrupt
                ? await hooks.onInterrupt(interruptSignal, state)
                : { action: 'continue' };
            // 应用用户指令
            if (directive.action === 'stop') {
                deps.trace.append({ ts: Date.now(), kind: 'stop', data: { reason: 'user_stopped' } });
                await config.onStop?.(state);
                return { status: 'completed', state };
            }
            else if (directive.action === 'modify_goal' && directive.newGoal) {
                state.goal = directive.newGoal;
                state.mode = 'plan';
                state.version++;
            }
            else {
                // continue - 继续执行，切回 plan
                if ((0, state_1.canTransition)(state.mode, 'plan')) {
                    state.mode = 'plan';
                    state.version++;
                }
            }
        }
        // ── 2. [终止条件] 三个检查（目标完成 / 无增益超限 / 迭代超限）────────────
        if (state.iterationCount >= t.maxIterations) {
            deps.trace.append({ ts: Date.now(), kind: 'stop', data: { reason: 'budget_exceeded' } });
            await config.onStop?.(state);
            // 保存状态再返回
            await deps.stateManager.save(deps.agentDir, state);
            return { status: 'budget_exceeded', state };
        }
        if (state.noProgressCount >= t.maxNoProgress) {
            const reason = '连续无增益，超出上限';
            deps.trace.append({ ts: Date.now(), kind: 'escalate', data: { reason } });
            await config.onEscalate?.(reason, state);
            // 保存状态再返回
            await deps.stateManager.save(deps.agentDir, state);
            return { status: 'escalated', reason, state };
        }
        // 检查目标是否完成
        if (!state.currentSubgoal && state.subgoals.length === 0) {
            deps.trace.append({ ts: Date.now(), kind: 'stop', data: { reason: 'goal_completed' } });
            await config.onStop?.(state);
            // 保存状态再返回
            await deps.stateManager.save(deps.agentDir, state);
            return { status: 'completed', state };
        }
        // ── 3. [Collect] → confidence 分支：补采集 / Escalate / 继续 ─────────────
        let collectResult = await (0, collect_1.collect)(config.collectConfig, deps.primitives, (tag) => deps.trace.filterByTag(tag));
        deps.trace.append({
            ts: Date.now(),
            kind: 'collect',
            data: { sources: config.collectConfig.sources.map(s => s.query) },
            confidence: collectResult.confidence,
        });
        // 补采集循环
        let collectRetry = 0;
        while (collectResult.confidence.coverage < t.confidenceMid &&
            collectResult.confidence.reliability >= t.confidenceMid &&
            collectRetry < t.maxCollectRetry) {
            collectRetry++;
            collectResult = await (0, collect_1.collect)(config.collectConfig, deps.primitives, (tag) => deps.trace.filterByTag(tag));
            deps.trace.append({
                ts: Date.now(),
                kind: 'collect',
                data: { retry: collectRetry },
                confidence: collectResult.confidence,
            });
        }
        // confidence 低 → Escalate
        if (collectResult.confidence.coverage < t.confidenceLow ||
            collectResult.confidence.reliability < t.confidenceLow) {
            const reason = `置信度不足: coverage=${collectResult.confidence.coverage.toFixed(2)}, reliability=${collectResult.confidence.reliability.toFixed(2)}`;
            deps.trace.append({
                ts: Date.now(),
                kind: 'escalate',
                data: { reason },
                confidence: collectResult.confidence,
            });
            await config.onEscalate?.(reason, state);
            return { status: 'escalated', reason, state };
        }
        // ── 4. [Plan 模式] LLMCall[Reason] → uncertainty 分支 ───────────────────
        if (state.mode === 'plan') {
            const taskDesc = state.currentSubgoal ?? state.goal;
            const reasonResult = await deps.llm.reason(collectResult.context, taskDesc);
            deps.trace.append({
                ts: Date.now(),
                kind: 'reason',
                data: { task: taskDesc, result: reasonResult.result },
                uncertainty: reasonResult.uncertainty,
            });
            // uncertainty 高 → 多候选或 Escalate
            if (reasonResult.uncertainty.score > t.uncertaintyHigh) {
                const multi = await deps.llm.reasonMulti(collectResult.context, taskDesc);
                deps.trace.append({
                    ts: Date.now(),
                    kind: 'reason',
                    data: { multi: true, candidates: multi.candidates },
                    uncertainty: multi.uncertainty,
                });
                if (multi.uncertainty.score > t.uncertaintyHigh) {
                    const reason = `Reason 不确定性过高: ${multi.uncertainty.score.toFixed(2)}`;
                    deps.trace.append({ ts: Date.now(), kind: 'escalate', data: { reason } });
                    await config.onEscalate?.(reason, state);
                    return { status: 'escalated', reason, state };
                }
                // 多候选 → Judge(selection) 仲裁
                const selResult = await deps.llm.judge('selection', collectResult.context, JSON.stringify(multi.candidates));
                deps.trace.append({
                    ts: Date.now(),
                    kind: 'judge',
                    data: { type: 'selection', decision: selResult.result },
                    uncertainty: selResult.uncertainty,
                });
                state.custom['pendingProposal'] = selResult.result;
            }
            else {
                state.custom['pendingProposal'] = reasonResult.result;
            }
            // ── Judge(risk) → 不通过时 Escalate ─────────────────────────────────
            const riskResult = await deps.llm.judge('risk', collectResult.context, String(state.custom['pendingProposal']));
            deps.trace.append({
                ts: Date.now(),
                kind: 'judge',
                data: { type: 'risk', decision: riskResult.result },
                uncertainty: riskResult.uncertainty,
            });
            const riskApproved = riskResult.result.toLowerCase().includes('通过') ||
                riskResult.result.toLowerCase().includes('pass') ||
                riskResult.result.toLowerCase().includes('approved') ||
                riskResult.result.toLowerCase().includes('yes');
            if (!riskApproved || riskResult.uncertainty.score > t.uncertaintyHigh) {
                const reason = `Judge(risk) 拒绝或不确定性过高: ${riskResult.result}`;
                deps.trace.append({ ts: Date.now(), kind: 'escalate', data: { reason } });
                await config.onEscalate?.(reason, state);
                return { status: 'escalated', reason, state };
            }
            // 切换到 Execute（经 canTransition 校验）
            if ((0, state_1.canTransition)(state.mode, 'execute')) {
                await hooks?.onModeTransition?.(state.mode, 'execute', state);
                state.mode = 'execute';
                state.version++;
                deps.trace.append({ ts: Date.now(), kind: 'state', data: { modeTransition: 'plan→execute' } });
            }
            continue;
        }
        // ── 5. [Execute 模式] ───────────────────────────────────────────────────
        if (state.mode === 'execute') {
            const proposal = String(state.custom['pendingProposal'] ?? '');
            // shouldSnapshot Hook → 快照失败阻断
            const shouldSnapshot = hooks?.shouldSnapshot
                ? await hooks.shouldSnapshot(state)
                : false;
            if (shouldSnapshot) {
                const snapshotOk = await deps.harness.snapshot(`iter-${state.iterationCount}`);
                if (!snapshotOk) {
                    deps.trace.append({ ts: Date.now(), kind: 'escalate', data: { reason: '快照失败，阻断执行' } });
                    await config.onEscalate?.('快照失败', state);
                    return { status: 'escalated', reason: '快照失败', state };
                }
            }
            // onBeforeExec Hook → block 时 Escalate
            const execDecision = hooks?.onBeforeExec
                ? await hooks.onBeforeExec(state, proposal)
                : 'proceed';
            if (execDecision === 'block') {
                const reason = 'onBeforeExec Hook 阻止执行';
                deps.trace.append({ ts: Date.now(), kind: 'escalate', data: { reason } });
                await config.onEscalate?.(reason, state);
                return { status: 'escalated', reason, state };
            }
            // 执行（写 Trace exec 条目）
            // 注意：这里需要记录 terminal_seq
            const terminalSeq = deps.terminalLog.getSeq();
            deps.trace.append({
                ts: Date.now(),
                kind: 'exec',
                data: { proposal },
                terminal_seq: terminalSeq > 0 ? terminalSeq : undefined,
            });
            // 切换到 Review
            if ((0, state_1.canTransition)(state.mode, 'review')) {
                await hooks?.onModeTransition?.(state.mode, 'review', state);
                state.mode = 'review';
                state.version++;
                deps.trace.append({ ts: Date.now(), kind: 'state', data: { modeTransition: 'execute→review' } });
            }
            continue;
        }
        // ── 6. [Review 模式] ───────────────────────────────────────────────────
        if (state.mode === 'review') {
            const outcomeResult = await deps.llm.judge('outcome', collectResult.context, `目标: ${state.currentSubgoal ?? state.goal}\n执行提案: ${state.custom['pendingProposal']}`);
            deps.trace.append({
                ts: Date.now(),
                kind: 'judge',
                data: { type: 'outcome', decision: outcomeResult.result },
                uncertainty: outcomeResult.uncertainty,
            });
            const achieved = outcomeResult.result.toLowerCase().includes('达成') ||
                outcomeResult.result.toLowerCase().includes('pass') ||
                outcomeResult.result.toLowerCase().includes('yes');
            if (!achieved || outcomeResult.uncertainty.score > t.uncertaintyHigh) {
                state.noProgressCount++;
                // 进入 Recovery 或重新 Plan
                if (state.noProgressCount >= t.maxNoProgress)
                    continue; // 下次迭代触发 Escalate
                if ((0, state_1.canTransition)(state.mode, 'recovery')) {
                    await hooks?.onModeTransition?.(state.mode, 'recovery', state);
                    state.mode = 'recovery';
                    state.version++;
                    deps.trace.append({ ts: Date.now(), kind: 'state', data: { modeTransition: 'review→recovery' } });
                }
                continue;
            }
            // 子目标完成，添加到 archivedSubgoals
            if (state.currentSubgoal) {
                // 写入 Memory（长期记忆）：记录用户请求 + 解决结论
                deps.memory.append({
                    userRequest: state.currentSubgoal,
                    solutionSummary: String(state.custom['pendingProposal'] ?? ''),
                    archivedSubgoal: state.currentSubgoal,
                });
                // 在 Trace 中追加 narrative 标记这次记忆更新
                deps.trace.append({
                    ts: Date.now(),
                    kind: 'narrative',
                    data: {
                        message: `子目标已完成: ${state.currentSubgoal}`,
                        solution: String(state.custom['pendingProposal'] ?? '').slice(0, 100),
                    },
                });
                state.archivedSubgoals.push(state.currentSubgoal);
                state.subgoals = state.subgoals.filter(g => g !== state.currentSubgoal);
                state.currentSubgoal = state.subgoals[0] ?? null;
            }
            // noProgressCount 重置
            state.noProgressCount = 0;
            // 仍有子目标 → 回 Plan
            if (state.subgoals.length > 0) {
                state.currentSubgoal = state.subgoals[0];
                if ((0, state_1.canTransition)(state.mode, 'plan')) {
                    await hooks?.onModeTransition?.(state.mode, 'plan', state);
                    state.mode = 'plan';
                    state.version++;
                    deps.trace.append({ ts: Date.now(), kind: 'state', data: { modeTransition: 'review→plan' } });
                }
            }
            // 否则下次迭代检测到 goal_completed → Stop
            continue;
        }
        // ── 7. [Recovery 模式] ─────────────────────────────────────────────────
        if (state.mode === 'recovery') {
            deps.trace.append({ ts: Date.now(), kind: 'state', data: { mode: 'recovery', action: '诊断与回退' } });
            // 错误分类：默认 logic（进 Recovery 时已经处理过错误了）
            // 如果有 classifyError hook，可以用它来判断是否需要回滚
            const shouldRollback = !hooks?.classifyError ||
                (() => {
                    const error = state.custom['lastError'];
                    const classified = hooks.classifyError(error);
                    return classified !== 'retryable';
                })();
            // 可重试错误直接重试，不回滚
            if (!shouldRollback) {
                if ((0, state_1.canTransition)(state.mode, 'plan')) {
                    await hooks?.onModeTransition?.(state.mode, 'plan', state);
                    state.mode = 'plan';
                    state.version++;
                    deps.trace.append({ ts: Date.now(), kind: 'state', data: { modeTransition: 'recovery→plan' } });
                }
                continue;
            }
            // 回滚
            await deps.harness.rollback();
            if ((0, state_1.canTransition)(state.mode, 'plan')) {
                await hooks?.onModeTransition?.(state.mode, 'plan', state);
                state.mode = 'plan';
                state.version++;
                state.custom['pendingProposal'] = null;
                deps.trace.append({ ts: Date.now(), kind: 'state', data: { modeTransition: 'recovery→plan' } });
            }
        }
        // ── 9. [Paused 模式] ───────────────────────────────────────────────────
        // Paused 模式的处理在 Interrupt 检查阶段已完成
        // 如果到达这里，说明 Paused 模式需要切回其他模式
        // ── 10. 每次迭代结束：State 持久化 ───────────────────────────────────────
        await deps.stateManager.save(deps.agentDir, state);
    }
}
//# sourceMappingURL=loop.js.map