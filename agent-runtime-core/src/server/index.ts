/**
 * Agent Runtime Core HTTP 服务
 * 内部 import SDK，对外暴露 HTTP 接口，供 Python 等客户端调用
 */

import path from 'path';
import fetch from 'node-fetch';
import express, { Request, Response } from 'express';
import {
  LLMCall,
  Trace,
  Harness,
  createInitialState,
  runLoop,
  type LLMProvider,
  type LoopResult,
  type AgentState,
  type CollectConfig,
  type CollectSource,
} from '../index';
import { createWorkDirPrimitives } from './primitives';

const app = express();
app.use(express.json({ limit: '2mb' }));

/** 请求体：运行一次 Agent 循环 */
export type RunRequestBody = {
  goal: string;
  subgoals?: string[];
  workDir: string;
  collectConfig: CollectConfig;
  llm: {
    baseUrl: string;
    model: string;
    apiKey: string;
  };
  thresholds?: {
    confidenceLow?: number;
    confidenceMid?: number;
    uncertaintyHigh?: number;
    maxIterations?: number;
    maxNoProgress?: number;
    maxCollectRetry?: number;
  };
};

/** 可序列化的 State 摘要（供 HTTP 返回） */
function serializeState(s: AgentState): Record<string, unknown> {
  return {
    goal: s.goal,
    subgoals: s.subgoals,
    currentSubgoal: s.currentSubgoal,
    mode: s.mode,
    permissions: s.permissions,
    iterationCount: s.iterationCount,
    noProgressCount: s.noProgressCount,
    version: s.version,
    custom: s.custom,
  };
}

/** 健康检查 */
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'agent-runtime-core' });
});

/**
 * POST /run
 * 执行一次 Agent 循环，返回 status、state 摘要、trace 序列化
 */
app.post('/run', async (req: Request, res: Response) => {
  try {
    const body = req.body as RunRequestBody;
    const { goal, subgoals = [], workDir, collectConfig, llm: llmConfig, thresholds } = body;

    if (!goal || typeof workDir !== 'string') {
      res.status(400).json({ error: '缺少 goal 或 workDir' });
      return;
    }
    if (!collectConfig?.sources?.length) {
      res.status(400).json({ error: 'collectConfig.sources 不能为空' });
      return;
    }
    if (!llmConfig?.baseUrl || !llmConfig?.model || !llmConfig?.apiKey) {
      res.status(400).json({ error: 'llm 需提供 baseUrl、model、apiKey' });
      return;
    }

    const baseUrl = llmConfig.baseUrl.replace(/\/$/, '');
    const provider: LLMProvider = {
      async complete(system: string, user: string): Promise<string> {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${llmConfig.apiKey}`,
          },
          body: JSON.stringify({
            model: llmConfig.model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
            temperature: 0.3,
            max_tokens: 1024,
          }),
        });
        if (!res.ok) throw new Error(`LLM API error: ${res.status} ${await res.text()}`);
        const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
        return data.choices[0].message.content;
      },
    };

    // file 类型且为相对路径时，解析为 workDir 下的绝对路径
    const resolvedCollectConfig: CollectConfig = {
      ...collectConfig,
      sources: collectConfig.sources.map((s: CollectSource) =>
        s.type === 'file' && !path.isAbsolute(s.query)
          ? { ...s, query: path.join(workDir, s.query) }
          : s,
      ),
    };

    // L0.5: 自动加载 AGENTS.md 作为静态上下文
    // 读取工作目录下的 AGENTS.md（如果存在），并添加到 collect 源的前面
    const agentsMdPath = path.join(workDir, 'AGENTS.md');
    try {
      const fs = await import('fs/promises');
      await fs.readFile(agentsMdPath, 'utf-8');
      // 将 AGENTS.md 添加到 sources 的最前面，权重最高
      resolvedCollectConfig.sources = [
        { type: 'file', query: agentsMdPath, weight: 1.0 } as CollectSource,
        ...resolvedCollectConfig.sources,
      ];
      console.log(`[L0.5] 自动加载 AGENTS.md: ${agentsMdPath}`);
    } catch {
      console.log(`[L0.5] AGENTS.md 不存在，跳过自动加载`);
    }

    const primitives = createWorkDirPrimitives(workDir);
    const llm = new LLMCall(provider);
    const trace = new Trace();
    const harness = new Harness(primitives, workDir);

    const state = createInitialState(goal, 2);
    if (subgoals.length > 0) {
      state.subgoals = subgoals;
      state.currentSubgoal = subgoals[0];
    } else {
      state.subgoals = [goal];
      state.currentSubgoal = goal;
    }

    const result: LoopResult = await runLoop(
      state,
      {
        collectConfig: resolvedCollectConfig,
        thresholds,
        workDir,  // L0.4: 传递 workDir 用于 Execute 模式下的路径解析
        onEscalate: async (reason) => {
          // 仅记录，不阻断返回
          trace.append({ ts: Date.now(), kind: 'escalate', data: { reason } });
        },
        onStop: async () => {},
      },
      primitives,
      llm,
      trace,
      harness,
    );

    res.json({
      status: result.status,
      reason: 'reason' in result ? result.reason : undefined,
      state: serializeState(result.state),
      traceJson: trace.serialize(),
      traceLength: trace.all().length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3889;
app.listen(PORT, () => {
  console.log(`Agent Runtime Core HTTP 服务: http://0.0.0.0:${PORT}`);
  console.log('  GET  /health  健康检查');
  console.log('  POST /run     执行 Agent 循环');
});
