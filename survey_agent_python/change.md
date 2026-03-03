# change.md - Survey Agent Python 调试与修复记录

## 原始问题

之前运行 /survey_agent_python 项目时发现的问题：
- seq:007 时模型已经输出了 Bash 命令执行的请求
- 但是 seq:009 时不是执行 bash 操作，而是再一次地 llmcall

## 调试分析

### 问题根源

通过分析 trace.jsonl 发现：

1. **seq:7 (Reason)**: 模型输出包含 `<invoke name="Bash">` 工具调用
2. **seq:8 (Multi)**: 因为 uncertainty = 0.80 > 0.70，系统进入多候选分支
3. **seq:9/10 (Escalate)**: 多候选的 uncertainty 也过高，导致 Escalate

核心问题在于：当 Reason 输出的 uncertainty 高于阈值时，系统完全丢弃了原始的工具调用提案，转而尝试多候选方案，最终导致 Escalate 而没有执行任何工具调用。

## 修复内容

### 修复 1: 优先执行包含工具调用的 Reason 输出

**位置**: `meta-agent-core/src/runtime/loop.ts`

**修改**:
1. 添加了 `hasToolCalls()` 函数，用于检查 Reason 输出是否包含有效的工具调用
2. 修改了 uncertainty 高时的处理逻辑：
   - 即使 uncertainty 高，如果原始 Reason 输出包含工具调用，仍优先执行工具调用
   - 只有在没有工具调用时，才进入多候选分支

**验证**:
- seq:8 现在显示 narrative 日志：`Reason uncertainty=0.80 is high, but found tool calls in proposal, proceeding to execute`
- 这证明修复已生效

### 修复 2: 扩展 Judge(risk) 判断关键词

**位置**: `meta-agent-core/src/runtime/loop.ts`

**修改**:
- 在 `riskApproved` 判断中添加了 'allow' 和 '允许' 关键词
- 原来只检查: '通过', 'pass', 'approved', 'yes'
- 新增: 'allow', '允许'

### 修复 3: 完善 package.json 构建脚本

**位置**: `meta-agent-core/package.json`

**修改**:
- 将 `npm run build` 改为实际编译输出到 dist 目录
- 添加 `npm run build:check` 用于类型检查

## 剩余问题

当前仍存在的问题：
1. Judge(risk) 调用时，LLM 返回的 JSON 解析失败 (uncertainty: 0.8, "JSON 解析失败")
   - 原因：LLM 返回的结果包含整个输入（包含工具调用），导致 JSON 解析失败
   - 这需要进一步调试 LLM 的 prompt 或调整解析逻辑

2. trace.jsonl 和 terminal.md 的记录可能存在重复
   - 需要进一步检查 primitives.ts 中的 logOperation 函数

## 测试结果

- 核心修复已生效：工具调用被正确识别并尝试执行
- 修复后 seq:8 显示 narrative 日志，证明修复已生效

(End of file - 75 lines)
