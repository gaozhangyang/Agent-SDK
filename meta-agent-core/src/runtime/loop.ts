// [编排层 / 循环] runtime/loop.ts — Loop 骨架 + LoopHooks 接口 + 终止条件

import { collect, type CollectConfig, type CollectSource } from '../core/collect';
import { LLMCall } from '../core/llm';
import { Trace, TerminalLog, type OperationType } from '../core/trace';
import { Memory } from '../core/memory';
import { Harness } from './harness';
import { canTransition, type AgentState, type Mode, type ArchivedSubgoal } from './state';
import { InterruptChannel, type InterruptSignal, type UserDirective } from './interrupt';
import { StateManager } from './state';
import type { Primitives } from '../core/primitives';

// 最大输出截断长度（100KB）
const MAX_OUTPUT_LENGTH = 100 * 1024;

/**
 * 解析并执行工具调用
 * 根据 change.md 问题2：LLM 返回的工具调用需要实际执行
 * 
 * @param proposal LLM 返回的包含工具调用的提案
 * @param primitives 执行工具的原语
 * @returns 执行结果字符串
 */
async function executeToolCalls(proposal: string, primitives: Primitives): Promise<string> {
  // 解析 <invoke name="X">...</invoke> 格式的工具调用
  const toolCallRegex = /<invoke name="(\w+)">([\s\S]*?)<\/invoke>/g;
  let match;
  let results: string[] = [];
  
  while ((match = toolCallRegex.exec(proposal)) !== null) {
    const toolName = match[1];
    const toolArgs = match[2];
    
    try {
      let result: string;
      if (toolName === 'Bash') {
        // 解析 command 参数
        const commandMatch = toolArgs.match(/<parameter name="command">([\s\S]*?)<\/parameter>/);
        const command = commandMatch ? commandMatch[1] : toolArgs.trim();
        result = await primitives.bash(command);
      } else if (toolName === 'Read') {
        // 解析 path 参数
        const pathMatch = toolArgs.match(/<parameter name="path">([\s\S]*?)<\/parameter>/);
        const path = pathMatch ? pathMatch[1] : toolArgs.trim();
        result = await primitives.read(path);
      } else if (toolName === 'Write') {
        // 解析 path 和 content 参数
        const pathMatch = toolArgs.match(/<parameter name="path">([\s\S]*?)<\/parameter>/);
        const contentMatch = toolArgs.match(/<parameter name="content">([\s\S]*?)<\/parameter>/);
        if (pathMatch && contentMatch) {
          await primitives.write(pathMatch[1], contentMatch[1]);
          result = `[Write] Written to ${pathMatch[1]}`;
        } else {
          result = `[Write] Failed: missing path or content parameter`;
        }
      } else if (toolName === 'Edit') {
        // 解析 path, old, next 参数
        const pathMatch = toolArgs.match(/<parameter name="path">([\s\S]*?)<\/parameter>/);
        const oldMatch = toolArgs.match(/<parameter name="old">([\s\S]*?)<\/parameter>/);
        const nextMatch = toolArgs.match(/<parameter name="next">([\s\S]*?)<\/parameter>/);
        if (pathMatch && oldMatch && nextMatch) {
          await primitives.edit(pathMatch[1], oldMatch[1], nextMatch[1]);
          result = `[Edit] Edited ${pathMatch[1]}`;
        } else {
          result = `[Edit] Failed: missing required parameters`;
        }
      } else {
        result = `[${toolName}] Unknown tool`;
      }
      results.push(result);
    } catch (error: any) {
      results.push(`[${toolName} failed]: ${error.message}`);
    }
  }
  
  if (results.length === 0) {
    return '[No tool calls found in proposal]';
  }
  
  return results.join('\n\n');
}

/**
 * 检查 Reason 输出是否包含有效的工具调用
 * 根据 change.md 问题：当 Reason 输出包含工具调用时，应该优先执行工具调用
 * 而不是因为 uncertainty 高就直接 Escalate
 * 
 * @param result Reason 输出的文本
 * @returns true if the result contains valid tool calls
 */
function hasToolCalls(result: string): boolean {
  // 检查是否包含 <invoke name="X"> 格式的工具调用
  const toolCallRegex = /<invoke name="(\w+)">/;
  return toolCallRegex.test(result);
}

/**
 * 截断过长的输出，并在末尾标记
 */
function truncateOutput(output: string | undefined | null): { content: string; truncated: boolean } {
  // 防御性检查：处理 undefined 或 null
  if (output == null) {
    return { content: '', truncated: false };
  }
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
    // noProgressCount 在 Review 阶段自增，但终止判断故意放在下一轮循环开头。
    // 原因：Review 判断「没有进展」后会先切到 Recovery 执行回滚，
    // 确保 escalate 时向上级交出干净的工作目录。
    // 因此这里触发 escalate 时，Recovery 已经完成了清理工作。
    if (state.iterationCount >= t.maxIterations) {
      deps.trace.append({ ts: Date.now(), kind: 'stop', data: { reason: 'budget_exceeded' } });
      
      // 任务终止时更新 Memory 的 solutionSummary
      const summary = `任务未完成（迭代次数超限，已完成 ${state.archivedSubgoals.length} 个子目标）`;
      deps.memory.updateLastEntry(summary, state.archivedSubgoals);
      
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
      deps.memory.updateLastEntry(summary, state.archivedSubgoals);
      
      await config.onEscalate?.(reason, state);
      // 保存状态再返回
      await deps.stateManager.save(deps.agentDir, state);
      return { status: 'escalated', reason, state };
    }

    // 检查目标是否完成
    if (!state.currentSubgoal && state.subgoals.length === 0) {
      deps.trace.append({ ts: Date.now(), kind: 'stop', data: { reason: 'goal_completed' } });
      
      // 任务完成时更新 Memory 的 solutionSummary
      const completedGoals = state.archivedSubgoals.map(s => s.goal).join(', ');
      const summary = state.archivedSubgoals.length > 0
        ? `已完成 ${state.archivedSubgoals.length} 个子目标: ${completedGoals}`
        : '任务已完成（无子目标）';
      deps.memory.updateLastEntry(summary, state.archivedSubgoals);
      
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
    
    // 记录 Collect 到 TerminalLog 和 Trace
    const { content: truncatedContext, truncated } = truncateOutput(collectResult.context);
    const collectSeq = deps.terminalLog.append({
      ts: Date.now(),
      operation: 'collect' as OperationType,
      input: JSON.stringify(config.collectConfig.sources),
      output: truncatedContext,
      truncated,
    });
    
    // 根据 change.md：Collect 补完整记录，使用与 terminalLog 相同的 seq
    deps.trace.append({
      ts: Date.now(),
      seq: collectSeq,  // 使用 terminalLog 分配的相同 seq，确保一致性
      kind: 'collect',
      data: { sources: config.collectConfig.sources.map((s: CollectSource) => s.query) },
      input: JSON.stringify(config.collectConfig.sources),  // 补齐 input
      output: truncatedContext,  // 补齐 output
      confidence: collectResult.confidence,
    });

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
      const llmcallSeq = deps.terminalLog.append({
        ts: Date.now(),
        operation: 'llmcall' as OperationType,
        input: llmInput,
        output: truncatedOutput,
        truncated,
      });
      
      // 防御性检查：确保 uncertainty 对象存在
      const uncertaintyScore = reasonResult.uncertainty?.score ?? 0.8;
      const uncertaintyReasons = reasonResult.uncertainty?.reasons ?? ['uncertainty undefined'];
      
      // 根据 change.md：LLMCall[Reason] 补完整记录，使用相同的 seq
      // v2: 包含 riskApproved 和 riskReason
      deps.trace.append({
        ts: Date.now(),
        seq: llmcallSeq,  // 使用 terminalLog 分配的相同 seq
        kind: 'reason',
        data: { task: taskDesc, result: reasonResult.result },
        input: llmInput,  // 补齐 input
        output: truncatedOutput,  // 补齐 output
        uncertainty: { score: uncertaintyScore, reasons: uncertaintyReasons },
        // v2: 记录 riskApproved 到 trace
        riskApproved: reasonResult.riskApproved,
        riskReason: reasonResult.riskReason,
      });

      // v2: 根据 change.md 修改1，删除 reasonMulti + judge('selection') 分支
      // 将不确定性推回模型侧处理，在 system prompt 中已添加指令
      
      // v2: 根据 change.md 修改2，使用 reason 返回的 riskApproved 字段
      // riskApproved === false 或 uncertainty.score > uncertaintyHigh → escalate
      const riskApproved = reasonResult.riskApproved ?? true;
      if (!riskApproved || uncertaintyScore > t.uncertaintyHigh) {
        const reason = !riskApproved 
          ? `Judge(risk) 拒绝: ${reasonResult.riskReason || '无风险说明'}`
          : `Reason 不确定性过高: ${uncertaintyScore.toFixed(2)}`;
        deps.trace.append({ ts: Date.now(), kind: 'escalate', data: { reason } });
        await config.onEscalate?.(reason, state);
        return { status: 'escalated', reason, state };
      }

      // v2: 将 pendingProposal 从 custom 改为强类型字段
      state.pendingProposal = reasonResult.result;

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
      // v2: 使用强类型字段 pendingProposal
      const proposal = state.pendingProposal ?? '';

      // shouldSnapshot Hook → 快照失败阻断
      const shouldSnapshot = hooks?.shouldSnapshot
        ? await hooks.shouldSnapshot(state)
        : false;

      if (shouldSnapshot) {
        const snapshotOk = await deps.harness.snapshot(`iter-${state.iterationCount}`);
        // v2: 根据 change.md 修改7，snapshot 失败的 escalate reason 细化
        if (!snapshotOk) {
          const reason = 'snapshot_failed';
          deps.trace.append({
            ts: Date.now(),
            kind: 'escalate',
            data: {
              reason: 'snapshot_failed',
              message: 'Cannot proceed: snapshot failed before executing tool calls. ' +
                       'Possible causes: disk full, permission denied, or Harness misconfiguration. ' +
                       'Refusing to execute without rollback capability.'
            }
          });
          await config.onEscalate?.(reason, state);
          return { status: 'escalated', reason, state };
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
      
      // 根据 change.md 问题2：实际执行工具调用
      // 解析并执行 LLM 返回的 <invoke name="X">...</invoke> 格式的工具调用
      const execResult = await executeToolCalls(proposal, deps.primitives);
      
      // 将执行结果存储到 state 中，供 Review 模式使用
      state.custom['lastExecResult'] = execResult;
      
      // 记录执行结果到 TerminalLog
      const { content: truncatedExecResult, truncated: execTruncated } = truncateOutput(execResult);
      const execSeq = deps.terminalLog.append({
        ts: Date.now(),
        operation: 'bash' as OperationType,
        input: proposal,
        output: truncatedExecResult,
        truncated: execTruncated,
      });
      
      // 记录到 trace，使用相同的 seq
      deps.trace.append({
        ts: Date.now(),
        seq: execSeq,  // 使用 terminalLog 分配的相同 seq
        kind: 'exec',
        data: { proposal, result: execResult },
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
      // 根据 change.md 问题2：将执行结果包含在 Review 的输入中
      const execResult = String(state.custom['lastExecResult'] ?? '[No execution result]');
      
      // v2: 使用强类型字段 pendingProposal
      const outcomeInput = `目标: ${state.currentSubgoal ?? state.goal}\n执行提案: ${state.pendingProposal ?? ''}\n执行结果:\n${execResult}`;
      const outcomeResult = await deps.llm.judge('outcome', collectResult.context, outcomeInput);
      
      const { content: truncatedOutput, truncated } = truncateOutput(outcomeResult.result);
      const outcomeSeq = deps.terminalLog.append({
        ts: Date.now(),
        operation: 'llmcall' as OperationType,
        input: outcomeInput,
        output: truncatedOutput,
        truncated,
      });
      
      // 根据 change.md：Judge 调用补齐 judge_type 字段，使用相同的 seq
      deps.trace.append({
        ts: Date.now(),
        seq: outcomeSeq,  // 使用 terminalLog 分配的相同 seq
        kind: 'judge',
        judge_type: 'outcome',  // 补齐 judge_type
        data: { type: 'outcome', decision: outcomeResult.result },
        input: outcomeInput,  // 补齐 input
        output: truncatedOutput,  // 补齐 output
        uncertainty: outcomeResult.uncertainty,
      });

      const achieved =
        outcomeResult.result.toLowerCase().includes('达成') ||
        outcomeResult.result.toLowerCase().includes('pass') ||
        outcomeResult.result.toLowerCase().includes('yes');

      const outcomeUncertaintyScore = outcomeResult.uncertainty?.score ?? 0.8;
      if (!achieved || outcomeUncertaintyScore > t.uncertaintyHigh) {
        // v2: 根据 change.md 修改6，在 Review 阶段 noProgressCount++ 处添加注释
        state.noProgressCount++;
        // 不在此处立即 escalate。
        // 切到 Recovery 先回滚环境，下一轮循环开头的终止条件会触发 escalate。
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
            solution: (state.pendingProposal ?? '').slice(0, 100),
          },
        });
        
        // 添加到 archivedSubgoals，包含结论和完成状态
        const archivedSubgoal: ArchivedSubgoal = {
          goal: state.currentSubgoal,
          summary: (state.pendingProposal ?? '').slice(0, 500),
          outcome: 'completed',
        };
        state.archivedSubgoals.push(archivedSubgoal);
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
      // v2: 使用强类型字段 pendingProposal，设置为 undefined
      state.pendingProposal = undefined;
      if (canTransition(state.mode, 'plan')) {
        await hooks?.onModeTransition?.(state.mode, 'plan', state);
        state.mode = 'plan';
        state.version++;
        deps.trace.append({ ts: Date.now(), kind: 'state', data: { modeTransition: 'recovery→plan' } });
      }
    }

    // ── 9. [Paused 模式] ───────────────────────────────────────────────────
    // v2: 根据 change.md 修改5，Paused 分支加防御性 throw
    // 正常情况下不应到达此处：Paused 的切走逻辑在循环开头的 Interrupt 检查阶段已完成。
    // 若执行到这里，说明 onInterrupt 没有正确切换 mode，属于内部错误。
    if (state.mode === 'paused') {
      throw new Error('Illegal state: reached paused branch in main loop switch. onInterrupt must transition mode away from paused.');
    }

    // ── 10. 每次迭代结束：State 持久化 ───────────────────────────────────────
    await deps.stateManager.save(deps.agentDir, state);
  }
}
