// [编排层 / 循环] runtime/loop.ts — Loop 骨架 + LoopHooks 接口 + 终止条件

import { collect, type CollectConfig } from '../core/collect';
import { LLMCall } from '../core/llm';
import { Trace, TerminalLog, type OperationType } from '../core/trace';
import { Memory } from '../core/memory';
import { Harness } from './harness';
import { canTransition, type AgentState, type Mode } from './state';
import { InterruptChannel, type InterruptSignal, type UserDirective } from './interrupt';
import { StateManager } from './state';
import type { Primitives } from '../core/primitives';

// 最大输出截断长度（100KB）
const MAX_OUTPUT_LENGTH = 100 * 1024;

/**
 * 截断过长的输出，并在末尾标记
 */
function truncateOutput(output: string): { content: string; truncated: boolean } {
  if (output.length > MAX_OUTPUT_LENGTH) {
    return {
      content: output.slice(0, MAX_OUTPUT_LENGTH) + '\n\n[... output truncated, exceeded 100KB limit]',
      truncated: true,
    };
  }
  return { content: output, truncated: false };
}

// 默认阈值（与 v1 完全相同）
export const DEFAULT_THRESHOLDS = {
  confidenceLow: 0.3,
  confidenceMid: 0.6,
  uncertaintyHigh: 0.7,
  maxCollectRetry: 3,
  maxNoProgress: 3,
  maxIterations: 50,
};

export type LoopHooks = {
  onBeforeExec?: (state: AgentState, proposal: string) => Promise<'proceed' | 'block'>;
  onAfterObserve?: (state: AgentState, result: string) => Promise<'continue' | 'recover' | 'escalate'>;
  onModeTransition?: (from: Mode, to: Mode, state: AgentState) => Promise<void>;
  shouldSnapshot?: (state: AgentState) => Promise<boolean>;
  classifyError?: (error: unknown) => 'retryable' | 'logic' | 'environment' | 'budget';
  onInterrupt?: (signal: InterruptSignal, state: AgentState) => Promise<UserDirective>;
};

export type LoopDeps = {
  primitives: Primitives;
  llm: LLMCall;
  trace: Trace;
  terminalLog: TerminalLog;
  memory: Memory;
  harness: Harness;
  interrupt: InterruptChannel;
  stateManager: StateManager;
  agentDir: string;   // .agent/ 目录路径，用于 State 持久化
  skillsDir?: string; // 可选的 skills 目录路径，用于 Collect 检索
};

export type LoopConfig = {
  collectConfig: CollectConfig;
  thresholds?: Partial<typeof DEFAULT_THRESHOLDS>;
  onEscalate?: (reason: string, state: AgentState) => Promise<void>;
  onStop?: (state: AgentState) => Promise<void>;
};

export type LoopResult =
  | { status: 'completed'; state: AgentState }
  | { status: 'escalated'; reason: string; state: AgentState }
  | { status: 'budget_exceeded'; state: AgentState };

/**
 * 运行 Agent 循环
 * 必须严格按 Loop 顺序执行
 */
export async function runLoop(
  state: AgentState,
  config: LoopConfig,
  deps: LoopDeps,
  hooks?: LoopHooks,
): Promise<LoopResult> {
  const t = { ...DEFAULT_THRESHOLDS, ...config.thresholds };

  // 任务开始时记录用户请求（仅首次运行时记录）
  if (state.iterationCount === 1 && state.archivedSubgoals.length === 0) {
    deps.memory.append({
      userRequest: state.goal,
      solutionSummary: '[任务进行中...]',
    });
  }

  while (true) {
    state.iterationCount++;

    // ── 1. [Interrupt 检查] poll() → 有信号时进入 Paused 处理 ─────────────
    const interruptSignal = deps.interrupt.poll();
    if (interruptSignal) {
      // 先快照保护现场
      await deps.harness.snapshot(`interrupt-iter-${state.iterationCount}`);
      
      // 切换到 Paused
      if (canTransition(state.mode, 'paused')) {
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
        : { action: 'continue' as const };

      // 应用用户指令
      if (directive.action === 'stop') {
        deps.trace.append({ ts: Date.now(), kind: 'stop', data: { reason: 'user_stopped' } });
        await config.onStop?.(state);
        return { status: 'completed', state };
      } else if (directive.action === 'modify_goal' && directive.newGoal) {
        state.goal = directive.newGoal;
        state.mode = 'plan';
        state.version++;
      } else {
        // continue - 继续执行，切回 plan
        if (canTransition(state.mode, 'plan')) {
          state.mode = 'plan';
          state.version++;
        }
      }
    }

    // ── 2. [终止条件] 三个检查（目标完成 / 无增益超限 / 迭代超限）────────────
    if (state.iterationCount >= t.maxIterations) {
      deps.trace.append({ ts: Date.now(), kind: 'stop', data: { reason: 'budget_exceeded' } });
      
      // 任务终止时更新 Memory 的 solutionSummary
      const summary = `任务未完成（迭代次数超限，已完成 ${state.archivedSubgoals.length} 个子目标）`;
      deps.memory.updateLastEntry(summary);
      
      await config.onStop?.(state);
      // 保存状态再返回
      await deps.stateManager.save(deps.agentDir, state);
      return { status: 'budget_exceeded', state };
    }

    if (state.noProgressCount >= t.maxNoProgress) {
      const reason = '连续无增益，超出上限';
      deps.trace.append({ ts: Date.now(), kind: 'escalate', data: { reason } });
      
      // 任务终止时更新 Memory 的 solutionSummary
      const summary = `任务未能完成（连续无增益，已完成 ${state.archivedSubgoals.length} 个子目标）`;
      deps.memory.updateLastEntry(summary);
      
      await config.onEscalate?.(reason, state);
      // 保存状态再返回
      await deps.stateManager.save(deps.agentDir, state);
      return { status: 'escalated', reason, state };
    }

    // 检查目标是否完成
    if (!state.currentSubgoal && state.subgoals.length === 0) {
      deps.trace.append({ ts: Date.now(), kind: 'stop', data: { reason: 'goal_completed' } });
      
      // 任务完成时更新 Memory 的 solutionSummary
      const summary = state.archivedSubgoals.length > 0
        ? `已完成 ${state.archivedSubgoals.length} 个子目标: ${state.archivedSubgoals.join(', ')}`
        : '任务已完成（无子目标）';
      deps.memory.updateLastEntry(summary);
      
      await config.onStop?.(state);
      // 保存状态再返回
      await deps.stateManager.save(deps.agentDir, state);
      return { status: 'completed', state };
    }

    // ── 3. [Collect] → confidence 分支：补采集 / Escalate / 继续 ─────────────
    let collectResult = await collect(
      config.collectConfig,
      deps.primitives,
      (tag) => deps.trace.filterByTag(tag),
      deps.skillsDir,  // 传递 skills 目录路径
    );
    
    // 记录 Collect 到 TerminalLog
    const { content: truncatedContext, truncated } = truncateOutput(collectResult.context);
    deps.terminalLog.append({
      ts: Date.now(),
      operation: 'collect' as OperationType,
      input: JSON.stringify(config.collectConfig.sources),
      output: truncatedContext,
      truncated,
    });
    
    deps.trace.append({
      ts: Date.now(),
      kind: 'collect',
      data: { sources: config.collectConfig.sources.map(s => s.query) },
      confidence: collectResult.confidence,
    });

    // 补采集循环
    let collectRetry = 0;
    while (
      collectResult.confidence.coverage < t.confidenceMid &&
      collectResult.confidence.reliability >= t.confidenceMid &&
      collectRetry < t.maxCollectRetry
    ) {
      collectRetry++;
      collectResult = await collect(
        config.collectConfig,
        deps.primitives,
        (tag) => deps.trace.filterByTag(tag),
        deps.skillsDir,
      );
      
      // 记录补采集到 TerminalLog
      const { content: truncatedContext, truncated } = truncateOutput(collectResult.context);
      deps.terminalLog.append({
        ts: Date.now(),
        operation: 'collect' as OperationType,
        input: JSON.stringify(config.collectConfig.sources),
        output: truncatedContext,
        truncated,
      });
      
      deps.trace.append({
        ts: Date.now(),
        kind: 'collect',
        data: { retry: collectRetry },
        confidence: collectResult.confidence,
      });
    }

    // confidence 低 → Escalate
    if (
      collectResult.confidence.coverage < t.confidenceLow ||
      collectResult.confidence.reliability < t.confidenceLow
    ) {
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
      
      // 记录 LLMCall reason 到 TerminalLog
      const llmInput = `Context:\n${collectResult.context}\n\nTask:\n${taskDesc}`;
      const reasonResult = await deps.llm.reason(collectResult.context, taskDesc);
      
      // 记录到 TerminalLog
      const { content: truncatedOutput, truncated } = truncateOutput(reasonResult.result);
      deps.terminalLog.append({
        ts: Date.now(),
        operation: 'llmcall' as OperationType,
        input: llmInput,
        output: truncatedOutput,
        truncated,
      });
      
      // 防御性检查：确保 uncertainty 对象存在
      const uncertaintyScore = reasonResult.uncertainty?.score ?? 0.8;
      const uncertaintyReasons = reasonResult.uncertainty?.reasons ?? ['uncertainty undefined'];
      
      deps.trace.append({
        ts: Date.now(),
        kind: 'reason',
        data: { task: taskDesc, result: reasonResult.result },
        uncertainty: { score: uncertaintyScore, reasons: uncertaintyReasons },
      });

      // uncertainty 高 → 多候选或 Escalate
      if (uncertaintyScore > t.uncertaintyHigh) {
        // 记录 LLMCall reasonMulti 到 TerminalLog
        const llmInput = `Context:\n${collectResult.context}\n\nTask:\n${taskDesc}`;
        const multi = await deps.llm.reasonMulti(collectResult.context, taskDesc);
        
        const { content: truncatedOutput, truncated } = truncateOutput(JSON.stringify(multi.candidates));
        deps.terminalLog.append({
          ts: Date.now(),
          operation: 'llmcall' as OperationType,
          input: llmInput,
          output: truncatedOutput,
          truncated,
        });
        
        deps.trace.append({
          ts: Date.now(),
          kind: 'reason',
          data: { multi: true, candidates: multi.candidates },
          uncertainty: multi.uncertainty,
        });

        const multiUncertaintyScore = multi.uncertainty?.score ?? 0.8;
        if (multiUncertaintyScore > t.uncertaintyHigh) {
          const reason = `Reason 不确定性过高: ${multiUncertaintyScore.toFixed(2)}`;
          deps.trace.append({ ts: Date.now(), kind: 'escalate', data: { reason } });
          await config.onEscalate?.(reason, state);
          return { status: 'escalated', reason, state };
        }

        // 多候选 → Judge(selection) 仲裁
        // 记录 LLMCall judge(selection) 到 TerminalLog
        const selectionInput = JSON.stringify(multi.candidates);
        const selResult = await deps.llm.judge('selection', collectResult.context, selectionInput);
        
        const { content: truncatedOutput2, truncated: truncated2 } = truncateOutput(selResult.result);
        deps.terminalLog.append({
          ts: Date.now(),
          operation: 'llmcall' as OperationType,
          input: selectionInput,
          output: truncatedOutput2,
          truncated: truncated2,
        });
        
        deps.trace.append({
          ts: Date.now(),
          kind: 'judge',
          data: { type: 'selection', decision: selResult.result },
          uncertainty: selResult.uncertainty,
        });
        state.custom['pendingProposal'] = selResult.result;
      } else {
        state.custom['pendingProposal'] = reasonResult.result;
      }

      // ── Judge(risk) → 不通过时 Escalate ─────────────────────────────────
      // 记录 LLMCall judge(risk) 到 TerminalLog
      const riskInput = String(state.custom['pendingProposal']);
      const riskResult = await deps.llm.judge('risk', collectResult.context, riskInput);
      
      const { content: truncatedOutput3, truncated: truncated3 } = truncateOutput(riskResult.result);
      deps.terminalLog.append({
        ts: Date.now(),
        operation: 'llmcall' as OperationType,
        input: riskInput,
        output: truncatedOutput3,
        truncated: truncated3,
      });
      
      deps.trace.append({
        ts: Date.now(),
        kind: 'judge',
        data: { type: 'risk', decision: riskResult.result },
        uncertainty: riskResult.uncertainty,
      });

      const riskApproved =
        riskResult.result.toLowerCase().includes('通过') ||
        riskResult.result.toLowerCase().includes('pass') ||
        riskResult.result.toLowerCase().includes('approved') ||
        riskResult.result.toLowerCase().includes('yes');

      const riskUncertaintyScore = riskResult.uncertainty?.score ?? 0.8;
      if (!riskApproved || riskUncertaintyScore > t.uncertaintyHigh) {
        const reason = `Judge(risk) 拒绝或不确定性过高: ${riskResult.result}`;
        deps.trace.append({ ts: Date.now(), kind: 'escalate', data: { reason } });
        await config.onEscalate?.(reason, state);
        return { status: 'escalated', reason, state };
      }

      // 切换到 Execute（经 canTransition 校验）
      if (canTransition(state.mode, 'execute')) {
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
      if (canTransition(state.mode, 'review')) {
        await hooks?.onModeTransition?.(state.mode, 'review', state);
        state.mode = 'review';
        state.version++;
        deps.trace.append({ ts: Date.now(), kind: 'state', data: { modeTransition: 'execute→review' } });
      }
      continue;
    }

    // ── 6. [Review 模式] ───────────────────────────────────────────────────
    if (state.mode === 'review') {
      // 记录 LLMCall judge(outcome) 到 TerminalLog
      const outcomeInput = `目标: ${state.currentSubgoal ?? state.goal}\n执行提案: ${state.custom['pendingProposal']}`;
      const outcomeResult = await deps.llm.judge('outcome', collectResult.context, outcomeInput);
      
      const { content: truncatedOutput, truncated } = truncateOutput(outcomeResult.result);
      deps.terminalLog.append({
        ts: Date.now(),
        operation: 'llmcall' as OperationType,
        input: outcomeInput,
        output: truncatedOutput,
        truncated,
      });
      
      deps.trace.append({
        ts: Date.now(),
        kind: 'judge',
        data: { type: 'outcome', decision: outcomeResult.result },
        uncertainty: outcomeResult.uncertainty,
      });

      const achieved =
        outcomeResult.result.toLowerCase().includes('达成') ||
        outcomeResult.result.toLowerCase().includes('pass') ||
        outcomeResult.result.toLowerCase().includes('yes');

      const outcomeUncertaintyScore = outcomeResult.uncertainty?.score ?? 0.8;
      if (!achieved || outcomeUncertaintyScore > t.uncertaintyHigh) {
        state.noProgressCount++;
        // 进入 Recovery 或重新 Plan
        if (state.noProgressCount >= t.maxNoProgress) continue; // 下次迭代触发 Escalate
        if (canTransition(state.mode, 'recovery')) {
          await hooks?.onModeTransition?.(state.mode, 'recovery', state);
          state.mode = 'recovery';
          state.version++;
          deps.trace.append({ ts: Date.now(), kind: 'state', data: { modeTransition: 'review→recovery' } });
        }
        continue;
      }

      // 子目标完成，添加到 archivedSubgoals
      if (state.currentSubgoal) {
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
        if (canTransition(state.mode, 'plan')) {
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
          const classified = hooks!.classifyError!(error);
          return classified !== 'retryable';
        })();

      // 可重试错误直接重试，不回滚
      if (!shouldRollback) {
        if (canTransition(state.mode, 'plan')) {
          await hooks?.onModeTransition?.(state.mode, 'plan', state);
          state.mode = 'plan';
          state.version++;
          deps.trace.append({ ts: Date.now(), kind: 'state', data: { modeTransition: 'recovery→plan' } });
        }
        continue;
      }

      // 回滚
      await deps.harness.rollback();
      if (canTransition(state.mode, 'plan')) {
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
