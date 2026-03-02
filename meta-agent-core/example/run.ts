// example/run.ts
// 任务：用 agent 自动分析一段有 bug 的代码，定位问题并输出修复建议

import fs from 'fs/promises';
import path from 'path';

// ── LLM 接入（与 v1 完全相同的接入方式）──────────────────────
const BASE_URL = 'http://35.220.164.252:3888/v1';
const MODEL    = 'MiniMax-M2.5';
const API_KEY  = 'My API Key';

import { createMetaAgent } from '../src/index';

async function setupWorkspace(dir: string) {
  await fs.mkdir(dir, { recursive: true });

  const { exec } = require('child_process');
  const run = (cmd: string, cwd = dir) => new Promise<void>((res, rej) =>
    exec(cmd, { cwd }, (err: any) => err ? rej(err) : res()));

  await run('git init');
  await run('git config user.email "agent@test.com"');
  await run('git config user.name "Agent"');

  await fs.writeFile(path.join(dir, 'AGENTS.md'), `
# 项目上下文
这是一个 TypeScript 工具库，包含数组处理函数。
目标：发现并修复代码中的 bug。
约定：修复建议写入 FIXME.md。
`.trim());

  await fs.writeFile(path.join(dir, 'utils.ts'), `
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

  await run('git add -A');
  await run('git commit -m "initial"');
}

async function main() {
  const workDir = path.join('/tmp', 'meta-agent-v2-' + Date.now());
  await setupWorkspace(workDir);

  console.log('═'.repeat(60));
  console.log('  Meta Agent Runtime Core SDK v2 — 端到端示例');
  console.log('  工作目录:', workDir);
  console.log('═'.repeat(60));

  // 使用 node 原生 fetch（Node 18+）或 node-fetch
  const realProvider = {
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
            { role: 'user',   content: user },
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

  const agent = await createMetaAgent(
    workDir,
    '分析 utils.ts 中的 bug，并将修复建议写入 FIXME.md',
    realProvider,
    {
      permissions: 2,
      subgoals: ['读取代码并定位 bug', '生成修复建议并写入 FIXME.md'],
      logToFile: true,
    }
  );

  // 模拟用户 5 秒后打断（测试 Interrupt 机制）
  setTimeout(() => {
    console.log('\n[用户打断] 发送 Interrupt 信号...');
    agent.interrupt('请继续，不需要修改目标');
  }, 5000);

  const result = await agent.run({
    collectConfig: {
      sources: [
        { type: 'file', query: path.join(workDir, 'AGENTS.md') },
        { type: 'file', query: path.join(workDir, 'utils.ts') },
      ],
      maxTokens: 2000,
    },
    thresholds: {
      confidenceLow:   0.2,
      confidenceMid:   0.5,
      uncertaintyHigh: 0.75,
      maxIterations:   20,
      maxNoProgress:   3,
    },
    onEscalate: async (reason, s) => {
      console.log('\n⚠️  [ESCALATE]', reason, '| mode:', s.mode);
    },
    onStop: async (s) => {
      console.log('\n✅ [STOP] 任务完成 | 迭代:', s.iterationCount);
    },
  });

  // 输出结果
  console.log('\n' + '─'.repeat(60));
  console.log('运行结果:    ', result.status);
  console.log('State 版本:  ', result.state.version);

  const trace = agent.getTrace();
  const terminalLog = agent.getTerminalLog();
  console.log('Trace 条数:  ', trace.all().length);
  console.log('Terminal 条数:', terminalLog.all().length);

  console.log('\nTrace 摘要:');
  for (const e of trace.all()) {
    const unc = e.uncertainty ? ` unc=${e.uncertainty.score.toFixed(2)}` : '';
    const cov = e.confidence  ? ` cov=${e.confidence.coverage.toFixed(2)}` : '';
    const tseq = e.terminal_seq ? ` →terminal#${e.terminal_seq}` : '';
    console.log(`  [${String(e.seq).padStart(3)}] ${e.kind}${unc}${cov}${tseq}`);
  }

  if (terminalLog.all().length > 0) {
    console.log('\nTerminal 摘要:');
    for (const e of terminalLog.all()) {
      console.log(`  [${String(e.seq).padStart(3)}] $ ${e.command.slice(0, 60)} (${e.durationMs}ms, exit=${e.exitCode})`);
    }
  }

  try {
    const fixme = await fs.readFile(path.join(workDir, 'FIXME.md'), 'utf-8');
    console.log('\nFIXME.md 内容:\n' + '─'.repeat(40));
    console.log(fixme);
  } catch {
    console.log('\n（agent 未写入 FIXME.md）');
  }

  // .agent/ 目录内容
  console.log('\n.agent/ 目录:');
  try {
    const files = await fs.readdir(path.join(workDir, '.agent'));
    for (const f of files) console.log(' ', f);
  } catch {}
}

main().catch(console.error);
