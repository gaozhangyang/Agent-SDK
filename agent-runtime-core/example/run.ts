/**
 * example/run.ts
 * 
 * 端到端示例：真实调用远程 LLM
 * 
 * 任务：用 agent 自动分析一段有 bug 的代码，定位问题并输出修复建议
 */

import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';

import {
  localPrimitives, LLMCall, Trace, Harness,
  createInitialState, runLoop,
  type LLMProvider,
} from '../src/index';

// ── LLM 接入配置 ───────────────────────────────────────────
const BASE_URL = 'http://35.220.164.252:3888/v1';
const MODEL    = 'MiniMax-M2.5';
const API_KEY  = 'sk-OzRhb0LmlrVf5UBy5WI6xenpKyEEGUl94kDbJcFvSgCI2sq9';

const realProvider: LLMProvider = {
  async complete(system: string, user: string): Promise<string> {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user',   content: user   },
        ],
        temperature: 0.3,
        max_tokens: 1024,
      }),
    });
    if (!res.ok) throw new Error(`LLM API error: ${res.status} ${await res.text()}`);
    const data = await res.json() as any;
    return data.choices[0].message.content;
  },
};

// ── 准备工作区（写入一段有 bug 的代码供 agent 分析）──────────
async function setupWorkspace(dir: string) {
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(path.join(dir, '.git'), { recursive: true });

  // 初始化 git（Harness 需要）
  const { exec } = require('child_process');
  const run = (cmd: string) => new Promise<void>((res, rej) =>
    exec(cmd, { cwd: dir }, (err: any) => err ? rej(err) : res()));
  await run('git init');
  await run('git config user.email "agent@test.com"');
  await run('git config user.name "Agent"');

  // 写入 AGENTS.md（L0.5 静态上下文）
  await fs.writeFile(path.join(dir, 'AGENTS.md'), `
# 项目上下文
这是一个 TypeScript 工具库，包含数组处理函数。
目标：发现并修复代码中的 bug。
约定：修复建议写入 FIXME.md。
`.trim());

  // 写入有 bug 的代码文件
  await fs.writeFile(path.join(dir, 'utils.ts'), `
// utils.ts — 存在两个 bug，请找出并修复

export function average(nums: number[]): number {
  let sum = 0;
  for (let i = 0; i <= nums.length; i++) {  // BUG 1: <= 应为 <
    sum += nums[i];
  }
  return sum / nums.length;
}

export function findMax(nums: number[]): number {
  let max = 0;  // BUG 2: 应初始化为 -Infinity 或 nums[0]
  for (const n of nums) {
    if (n > max) max = n;
  }
  return max;
}
`.trim());

  // 初始提交
  await run('git add -A');
  await run('git commit -m "initial"');

  return dir;
}

// ── 主程序 ─────────────────────────────────────────────────
async function main() {
  const workDir = path.join('/tmp', 'agent-example-' + Date.now());
  await setupWorkspace(workDir);

  console.log('═'.repeat(60));
  console.log('  Agent Runtime Core SDK — 端到端示例');
  console.log('  工作目录:', workDir);
  console.log('═'.repeat(60));

  const primitives = localPrimitives;
  const llm   = new LLMCall(realProvider);
  const trace = new Trace();
  const harness = new Harness(primitives, workDir);

  const state = createInitialState('分析 utils.ts 中的 bug，并将修复建议写入 FIXME.md', 2);
  state.subgoals = ['读取代码并定位 bug', '生成修复建议并写入 FIXME.md'];
  state.currentSubgoal = state.subgoals[0];

  const result = await runLoop(
    state,
    {
      collectConfig: {
        sources: [
          { type: 'file',  query: path.join(workDir, 'AGENTS.md') },
          { type: 'file',  query: path.join(workDir, 'utils.ts')  },
        ],
        maxTokens: 2000,
      },
      thresholds: {
        confidenceLow:  0.2,
        confidenceMid:  0.5,
        uncertaintyHigh: 0.75,
        maxIterations:  20,
        maxNoProgress:  3,
      },
      onEscalate: async (reason, s) => {
        console.log('\n⚠️  [ESCALATE]', reason);
        console.log('   当前 Mode:', s.mode, '| 迭代:', s.iterationCount);
      },
      onStop: async (s) => {
        console.log('\n✅ [STOP] 任务完成');
        console.log('   迭代次数:', s.iterationCount, '| 最终 Mode:', s.mode);
      },
    },
    primitives,
    llm,
    trace,
    harness,
  );

  // ── 输出结果 ─────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  console.log('运行结果:', result.status);
  console.log('State 版本号:', result.state.version);
  console.log('Trace 条数:', trace.all().length);

  console.log('\nTrace 摘要:');
  for (const entry of trace.all()) {
    const unc = entry.uncertainty ? ` uncertainty=${entry.uncertainty.score.toFixed(2)}` : '';
    const cov = entry.confidence  ? ` coverage=${entry.confidence.coverage.toFixed(2)}` : '';
    console.log(`  [${entry.kind}]${unc}${cov}`);
  }

  // 如果 agent 写入了 FIXME.md，展示内容
  try {
    const fixme = await primitives.read(path.join(workDir, 'FIXME.md'));
    console.log('\nFIXME.md 内容:\n' + '─'.repeat(40));
    console.log(fixme);
  } catch {
    console.log('\n（agent 未写入 FIXME.md，可在 loop.ts 的 execute 模式中补充 write 调用）');
  }

  // 保存完整 Trace
  const traceFile = path.join(workDir, 'trace.json');
  await primitives.write(traceFile, trace.serialize());
  console.log('\nTrace 已保存至:', traceFile);
}

main().catch(console.error);
