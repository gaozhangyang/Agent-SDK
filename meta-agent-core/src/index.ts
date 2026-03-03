// 对外入口 index.ts — 导出所有模块 + createMetaAgent 工厂
// 修改：统一 seq 序号空间、AGENT.md strategies 配置

import path from 'path';
import fs from 'fs/promises';
import { localPrimitives, type Primitives, parseTruncationConfig } from './core/primitives';
import { LLMCall, type LLMProvider, type JudgeType, type LLMCallResult, type LLMCallMulti } from './core/llm';
import { collect, type CollectConfig, type CollectSource, type CollectResult } from './core/collect';
import { Trace, TerminalLog, GlobalSeqManager, type TraceEntry, type TerminalEntry, type Confidence, type Uncertainty } from './core/trace';
import { Memory, type MemoryEntry, type Subgoal } from './core/memory';
import { Harness } from './runtime/harness';
import { runLoop, type LoopConfig, type LoopResult, type LoopHooks, type LoopDeps } from './runtime/loop';
import { StateManager, canTransition, createInitialState, type AgentState, type PermissionLevel, type Mode, type ArchivedSubgoal, type SubgoalOutcome } from './runtime/state';
import { InterruptChannel, type InterruptSignal, type UserDirective } from './runtime/interrupt';
import { createModeHooks } from './hooks/mode-state-machine';
import { createPermissionHooks } from './hooks/permission-guard';
import { createErrorClassifier } from './hooks/error-classifier';

// ── 导出所有模块（兼容 v1 的导出方式，额外导出 v2 新增内容）──────────────────

// 兼容 v1
export { type Primitives };
export { LLMCall, type LLMProvider, type JudgeType, type LLMCallResult, type LLMCallMulti };
export { collect, type CollectConfig, type CollectSource, type CollectResult };
export { Trace, TerminalLog, GlobalSeqManager, type TraceEntry, type TerminalEntry, type Confidence, type Uncertainty };
export { Memory, type MemoryEntry, type Subgoal };
export { Harness };
export { runLoop, type LoopConfig, type LoopResult, type LoopHooks, type LoopDeps };
export { canTransition, createInitialState, type AgentState, type PermissionLevel, type Mode, type ArchivedSubgoal, type SubgoalOutcome };

// v2 新增
export { StateManager };
export { InterruptChannel, type InterruptSignal, type UserDirective };
export { createModeHooks };
export { createPermissionHooks };
export { createErrorClassifier };

// ── AGENT.md strategies 配置 ─────────────────────────────────────────────────

/**
 * AGENT.md 中定义的策略层配置
 * 来自 change.md 修改四：AGENT.md 增加策略层配置
 */
export interface AgentStrategiesConfig {
  level?: 'L0' | 'L1' | 'L2' | 'L3';
  permissions?: PermissionLevel;  // 权限级别：0-4
  mode_fsm?: 'enabled' | 'disabled';
  permission_fsm?: 'enabled' | 'disabled';
  harness?: 'standard' | 'aggressive' | 'disabled';
  error_classifier?: 'enabled' | 'disabled';
  judge?: {
    outcome?: 'required' | 'rule_based' | 'disabled';
    milestone?: 'enabled' | 'disabled';
    capability?: 'enabled' | 'disabled';
  };
}

/**
 * 从 AGENT.md 内容中解析策略层配置
 * 支持两种格式：
 * 1. ```json 代码块中的 JSON 格式
 * 2. YAML 格式（向后兼容）
 */
export function parseStrategiesConfig(agentMdContent?: string): AgentStrategiesConfig {
  const defaultConfig: AgentStrategiesConfig = {
    level: 'L1',
    permissions: 2,  // 默认权限级别：受控执行（常规 bash 命令）
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
      const config: AgentStrategiesConfig = { ...defaultConfig };
      
      if (parsed.level) config.level = parsed.level;
      if (typeof parsed.permissions === 'number' && parsed.permissions >= 0 && parsed.permissions <= 4) {
        config.permissions = parsed.permissions;
      }
      if (parsed.mode_fsm) config.mode_fsm = parsed.mode_fsm;
      if (parsed.permission_fsm) config.permission_fsm = parsed.permission_fsm;
      if (parsed.harness) config.harness = parsed.harness;
      if (parsed.error_classifier) config.error_classifier = parsed.error_classifier;
      
      if (parsed.judge) {
        config.judge = { ...defaultConfig.judge, ...parsed.judge };
      }
      
      return config;
    } catch (e) {
      console.warn('Failed to parse JSON config block, falling back to YAML parsing:', e);
    }
  }
  
  // 解析 strategies 配置块（YAML 格式，向后兼容）
  const strategiesMatch = agentMdContent.match(/strategies:\s*([\s\S]*?)(?=\n\S|\n$|$)/i);
  if (!strategiesMatch) {
    return defaultConfig;
  }
  
  const strategiesContent = strategiesMatch[1];
  const config: AgentStrategiesConfig = { ...defaultConfig };
  
  // 解析 level
  const levelMatch = strategiesContent.match(/level:\s*(L\d+)/i);
  if (levelMatch) {
    config.level = levelMatch[1] as AgentStrategiesConfig['level'];
  }
  
  // 解析 permissions
  const permissionsMatch = strategiesContent.match(/permissions:\s*(\d+)/i);
  if (permissionsMatch) {
    const permLevel = parseInt(permissionsMatch[1], 10);
    if (permLevel >= 0 && permLevel <= 4) {
      config.permissions = permLevel as PermissionLevel;
    }
  }
  
  // 解析 mode_fsm
  const modeFsmMatch = strategiesContent.match(/mode_fsm:\s*(enabled|disabled)/i);
  if (modeFsmMatch) {
    config.mode_fsm = modeFsmMatch[1] as AgentStrategiesConfig['mode_fsm'];
  }
  
  // 解析 permission_fsm
  const permFsmMatch = strategiesContent.match(/permission_fsm:\s*(enabled|disabled)/i);
  if (permFsmMatch) {
    config.permission_fsm = permFsmMatch[1] as AgentStrategiesConfig['permission_fsm'];
  }
  
  // 解析 harness
  const harnessMatch = strategiesContent.match(/harness:\s*(standard|aggressive|disabled)/i);
  if (harnessMatch) {
    config.harness = harnessMatch[1] as AgentStrategiesConfig['harness'];
  }
  
  // 解析 error_classifier
  const errorMatch = strategiesContent.match(/error_classifier:\s*(enabled|disabled)/i);
  if (errorMatch) {
    config.error_classifier = errorMatch[1] as AgentStrategiesConfig['error_classifier'];
  }
  
  // 解析 judge 配置块
  const judgeBlockMatch = strategiesContent.match(/judge:\s*([\s\S]*?)(?=\n\S|$)/i);
  if (judgeBlockMatch) {
    const judgeContent = judgeBlockMatch[1];
    const defaultJudge: AgentStrategiesConfig['judge'] = {
      outcome: 'required',
      milestone: 'enabled',
      capability: 'enabled',
    };
    
    const outcomeMatch = judgeContent.match(/outcome:\s*(required|rule_based|disabled)/i);
    if (outcomeMatch) defaultJudge.outcome = outcomeMatch[1] as 'required' | 'rule_based' | 'disabled';
    
    const milestoneMatch = judgeContent.match(/milestone:\s*(enabled|disabled)/i);
    if (milestoneMatch) defaultJudge.milestone = milestoneMatch[1] as 'enabled' | 'disabled';
    
    const capabilityMatch = judgeContent.match(/capability:\s*(enabled|disabled)/i);
    if (capabilityMatch) defaultJudge.capability = capabilityMatch[1] as 'enabled' | 'disabled';
    
    config.judge = defaultJudge;
  }
  
  return config;
}

// ── Thresholds 配置 ─────────────────────────────────────────────────

/**
 * AGENT.md 中定义的运行时阈值配置
 * 用于控制 Agent 循环的行为边界
 */
export interface AgentThresholdsConfig {
  confidenceLow?: number;      // 置信度低阈值（默认 0.3）
  confidenceMid?: number;     // 置信度中阈值（默认 0.6）
  uncertaintyHigh?: number;    // 不确定性高阈值（默认 0.7）
  maxCollectRetry?: number;   // 最大收集重试次数（默认 3）
  maxNoProgress?: number;      // 最大无进展次数（默认 3）
  maxIterations?: number;      // 最大迭代次数（默认 50）
}

/**
 * 从 AGENT.md 内容中解析阈值配置
 * 支持从 ```json 代码块中解析 thresholds 字段
 */
export function parseThresholdsConfig(agentMdContent?: string): AgentThresholdsConfig | undefined {
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
      const thresholds: AgentThresholdsConfig = {};
      
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
  } catch (e) {
    console.warn('Failed to parse thresholds config from AGENT.md:', e);
    return undefined;
  }
}

// ── createMetaAgent 工厂函数 ─────────────────────────────────────────────────

export interface MetaAgent {
  run(loopConfig?: Partial<LoopConfig>): Promise<LoopResult>;
  interrupt(message: string): void;
  getState(): AgentState;
  getTrace(): Trace;
  getTerminalLog(): TerminalLog;
  getMemory(): Memory;
}

export async function createMetaAgent(
  projectPath: string,
  goal: string,
  llmProvider: LLMProvider,
  options?: {
    permissions?: PermissionLevel;
    subgoals?: string[];
    logToFile?: boolean;       // 是否将 Trace/TerminalLog 持久化到 .agent/ 目录
    hooks?: LoopHooks;         // 自定义 Hook（覆盖标准 Hook）
    collectConfig?: CollectConfig;
    agentMdContent?: string;  // AGENT.md 静态上下文内容
    skillsDir?: string;        // skills 目录路径（可选）
  }
): Promise<MetaAgent> {
  // 1. 创建 .agent/ 目录
  const agentDir = path.join(projectPath, '.agent');
  await fs.mkdir(agentDir, { recursive: true });

  // 2. 解析 AGENT.md 中的策略层配置
  const strategiesConfig = parseStrategiesConfig(options?.agentMdContent);

  // 3. 初始化 Trace、TerminalLog 和 Memory
  // 遵循 agent-design-principles-v2.md 核心层 4：项目目录约定
  // 遵循 change.md 修改：terminal.log → terminal.md
  const traceLogPath = options?.logToFile ? path.join(agentDir, 'trace.jsonl') : undefined;
  const terminalLogPath = options?.logToFile ? path.join(agentDir, 'terminal.md') : undefined; // 改为 .md
  const memoryLogPath = options?.logToFile ? path.join(agentDir, 'memory.jsonl') : undefined;
  
  // 创建全局序号管理器（统一 seq 序号空间）
  const seqManager = new GlobalSeqManager(traceLogPath);
  
  const trace = new Trace(traceLogPath);
  trace.setSeqManager(seqManager);  // 将 seqManager 注入到 Trace
  // 将 seqManager 注入到 TerminalLog
  const terminalLog = new TerminalLog(traceLogPath, terminalLogPath, projectPath);
  terminalLog.setSeqManager(seqManager);
  const memory = new Memory(memoryLogPath);

  // 4. 用 localPrimitives 创建原语
  // coreDir 为当前 SDK 的 src/ 目录绝对路径
  // 从 AGENT.md 解析截断配置
  const truncationConfig = parseTruncationConfig(options?.agentMdContent);
  const coreDir = path.resolve(__dirname, '..');
  // 传入 trace 实例，用于补齐 trace.jsonl 的 kind 字段
  const primitives = localPrimitives(coreDir, terminalLog, trace, truncationConfig);

  // 5. 用 StateManager 尝试恢复 State，失败则 createInitial
  const stateManager = new StateManager();
  let state = await stateManager.load(agentDir);
  const isResumed = state !== null;
  
  if (!state) {
    state = stateManager.createInitial(goal, options?.permissions ?? 2);
    if (options?.subgoals) {
      state.subgoals = options.subgoals;
      state.currentSubgoal = options.subgoals[0] ?? null;
    }
    await stateManager.save(agentDir, state);
  } else {
    // Session 恢复：加载累积的 Trace、TerminalLog 和 Memory
    // 这样可以继续之前的序列号，保证日志的连续性
    if (traceLogPath) await trace.loadFromFile();
    if (terminalLogPath) await terminalLog.loadFromFile();
    if (memoryLogPath) await memory.loadFromFile();
  }

  // 6. 根据 strategiesConfig 组合 hooks
  // 只有当对应策略 enabled 时才启用
  const standardHooks: LoopHooks = {};
  
  // Mode 状态机
  if (strategiesConfig.mode_fsm === 'enabled') {
    Object.assign(standardHooks, createModeHooks(trace));
  }
  
  // 权限状态机
  if (strategiesConfig.permission_fsm === 'enabled') {
    Object.assign(standardHooks, createPermissionHooks());
  }
  
  // 错误分类
  if (strategiesConfig.error_classifier === 'enabled') {
    Object.assign(standardHooks, createErrorClassifier());
  }
  
  // options.hooks 优先级高于标准 hooks
  const mergedHooks: LoopHooks = {
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
  const llm = new LLMCall(llmProvider);
  
  // 设置静态上下文（AGENT.md 内容）
  if (options?.agentMdContent) {
    llm.setStaticContext(options.agentMdContent);
  }

  // 8. 创建 Harness 和 InterruptChannel
  const harness = new Harness(primitives, projectPath, agentDir);
  const interrupt = new InterruptChannel();

  // 9. 构建 LoopDeps
  const deps: LoopDeps = {
    primitives,
    llm,
    trace,
    terminalLog,
    memory,
    harness,
    interrupt,
    stateManager,
    agentDir,
    skillsDir: options?.skillsDir,  // 传递 skills 目录路径
  };

  // 10. 返回 MetaAgent 对象
  return {
    run: async (loopConfig?: Partial<LoopConfig>): Promise<LoopResult> => {
      const fullConfig: LoopConfig = {
        collectConfig: options?.collectConfig ?? { sources: [] },
        ...loopConfig,
      };
      return runLoop(state!, fullConfig, deps, mergedHooks);
    },

    interrupt: (message: string): void => {
      interrupt.push({ message, ts: Date.now() });
    },

    getState: (): AgentState => state!,
    getTrace: (): Trace => trace,
    getTerminalLog: (): TerminalLog => terminalLog,
    getMemory: (): Memory => memory,
  };
}
