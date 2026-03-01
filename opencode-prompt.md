# OpenCode Prompt：Agent Runtime Core SDK 实现任务

---

## 你的任务

你需要完整实现一个 **Agent Runtime Core SDK**，严格遵循以下两份文档的设计原则，通过所有单元测试，并跑通一个真实的端到端调用示例。

---

## 输入文档

请先阅读以下两份文档，再开始任何编码工作：

1. **设计原则文档**：`agent-design-principles-tiered.md`
2. **实现方案文档**：`agent-runtime-core-sdk.md`

阅读完毕后，在 Trace 中记录你的理解摘要，然后开始实现。

---

## 项目初始化

```bash
mkdir agent-runtime-core && cd agent-runtime-core
npm init -y
npm install typescript ts-node @types/node
npx tsc --init --target ES2022 --module commonjs --strict --outDir dist --rootDir src
mkdir -p src tests
```

---

## 实现要求

### 文件结构（严格按此创建）

```
agent-runtime-core/
├── src/
│   ├── trace.ts
│   ├── primitives.ts
│   ├── llm.ts
│   ├── collect.ts
│   ├── harness.ts
│   ├── state.ts
│   ├── loop.ts
│   └── index.ts
├── tests/
│   ├── trace.test.ts
│   ├── primitives.test.ts
│   ├── llm.test.ts
│   ├── collect.test.ts
│   ├── harness.test.ts
│   ├── state.test.ts
│   ├── loop.test.ts
│   └── integration.test.ts
├── example/
│   └── run.ts           ← 端到端真实调用示例
└── package.json
```

### 实现规则（必须遵守，否则视为不合格）

1. **原语接口不可变**：`primitives.ts` 中四个函数签名必须与方案文档完全一致
2. **Judge 必须显式 type**：所有 `llm.judge()` 调用必须传入 `'outcome' | 'risk' | 'selection'`
3. **快照失败必须阻断**：`harness.snapshot()` 返回 `false` 时，`loop.ts` 必须立即返回 `escalated`
4. **Mode 切换必须校验**：所有 `state.mode =` 赋值前必须调用 `canTransition()` 并检查返回值
5. **confidence 和 uncertainty 必须写入 Trace**：每次 Collect 和 LLMCall 后都要 `trace.append()`
6. **终止条件是一等概念**：循环开头必须先检查终止条件，不能放在循环末尾

---

## 测试要求

安装测试框架：
```bash
npm install --save-dev jest ts-jest @types/jest
```

`package.json` 中加入：
```json
"scripts": {
  "test": "jest --testPathPattern=tests/",
  "test:coverage": "jest --coverage",
  "example": "ts-node example/run.ts"
}
```

### 每个测试文件的测试点

**`trace.test.ts`**
- `append()` 后 `all()` 长度正确
- `filterByTag()` 只返回含该 tag 的条目
- `serialize()` 输出合法 JSON

**`primitives.test.ts`**
- `read()` 读取真实临时文件内容正确
- `write()` 写入后 `read()` 可读回
- `edit()` 唯一匹配时替换成功
- `edit()` 多处匹配时抛出错误（不能静默失败）
- `bash()` 执行 `echo hello` 返回 `"hello\n"`

**`llm.test.ts`**
- `reason()` 返回含 `result` 和 `uncertainty` 字段
- `reasonMulti()` 返回 `candidates` 数组，长度 ≥ 2
- `judge('outcome', ...)` 不抛出异常
- `judge('risk', ...)` 不抛出异常
- `judge('selection', ...)` 不抛出异常
- JSON 解析失败时 `uncertainty.score` 应为 0.8（降级处理）

**`collect.test.ts`**
- `coverage` = 成功来源数 / 总来源数
- 来源读取失败时该来源进入 `gaps`，`by_source` 中该 key 为 0
- `maxTokens` 生效时 context 长度不超过 `maxTokens * 4` 字符

**`harness.test.ts`**
- 在真实 git 仓库中 `snapshot()` 返回 `true`
- 在非 git 目录中 `snapshot()` 返回 `false`（不抛出）
- `rollback()` 无快照历史时返回 `false`（不抛出）

**`state.test.ts`**
- `createInitialState()` 默认 mode 为 `'plan'`
- `canTransition('plan', 'execute')` 返回 `true`
- `canTransition('plan', 'review')` 返回 `false`
- `canTransition('recovery', 'execute')` 返回 `false`
- 覆盖所有合法切换路径

**`loop.test.ts`**（使用 mock LLMProvider）
- `maxIterations` 超出时返回 `{ status: 'budget_exceeded' }`
- 快照失败时返回 `{ status: 'escalated', reason: 含'快照' }`
- confidence 低于 `confidenceLow` 阈值时触发 escalate
- `noProgressCount` 超出 `maxNoProgress` 时触发 escalate
- subgoals 全部完成时返回 `{ status: 'completed' }`

**`integration.test.ts`**（使用 mock，完整跑通一次循环）
- 从 `plan` 模式启动，经过 `execute → review`，最终 `completed`
- Trace 中包含 `collect`、`reason`、`judge`、`exec`、`stop` 类型条目
- State.version 在每次 mode 切换后递增

---

## 端到端示例（`example/run.ts`）

这个文件必须真实调用远程 LLM，不能用 mock。

```typescript
// example/run.ts
// 任务：用 agent 自动分析一段有 bug 的代码，定位问题并输出修复建议

import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';  // npm install node-fetch@2

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
```

---

## 执行顺序

实现完成后，按以下顺序验证：

```bash
# 1. 编译检查（零 TypeScript 错误）
npx tsc --noEmit

# 2. 全量测试（必须全部通过）
npm test

# 3. 覆盖率报告（目标 > 80%）
npm run test:coverage

# 4. 端到端示例（真实调用 LLM）
npm run example
```

---

## 验收标准

| 验收项 | 标准 |
|--------|------|
| TypeScript 编译 | 零错误，零 `any` 警告 |
| 单元测试 | 全部通过，覆盖率 > 80% |
| 原语接口 | 签名与方案文档 100% 一致 |
| Judge type | 所有调用均显式传入 type |
| Harness 阻断 | snapshot 失败必定返回 escalated |
| 端到端示例 | 成功连接 LLM，Trace 包含 ≥ 5 条记录，进程正常退出 |

---

## 常见陷阱提示

- `edit()` 必须验证 `old` 在文件中唯一匹配，不唯一时抛出带次数信息的错误
- `collect.ts` 中 `coverage` 计算：失败来源计入分母但不计入分子
- `loop.ts` 中 LLM 判断 `riskApproved`：需要同时检查中英文关键词（`"通过" || "pass" || "approved"`）
- `harness.ts` 中 git 命令使用 `--allow-empty` 避免无改动时 commit 失败
- `example/run.ts` 中 `node-fetch@2` 与 CommonJS 兼容，不要用 v3
- 端到端示例的 `execute` 阶段需要真实调用 `primitives.write()` 写入结果，否则 `Judge(outcome)` 永远无法达成目标

---

## 完成后输出

完成所有实现后，请输出：

```
✅ 实现完成报告
- 文件数量：X 个
- 测试通过：X / X
- 覆盖率：X%
- 端到端示例状态：成功 / 失败（附原因）
- Trace 条数：X
- LLM 调用次数：X
```
