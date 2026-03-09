# Meta-Agent 重构方案

## 核心原则

- 算法结构尽可能简洁，去掉所有中间状态
- context 是唯一的信息载体，足够用于解决问题即可
- 信息流只有一个方向：子节点完成后写入父节点 context.md
- 根节点是唯一例外，保留 results.md 作为最终输出

---

## 最终算法（以此为基准实现）

```python
def meta_agent(goal_dir, depth):
    # 探针：读取父节点context.md + 当前环境，形成当前节点的上下文
    context = probe(goal_dir)

    if depth >= max_depth or decision == "direct":
        # 直接执行模式：LLM生成script，执行后产生observation
        script = LLMCall(context, goal)
        observation = Act(script)  # script主动print出需要被观测的信息

        # 验证：verifier只判断pass/fail，不负责提炼信息
        feedback = LLMCall(verifier, script, observation)
        # 失败时，失败原因本身就是observation，同样写入父节点context
        observation = observation if feedback.pass else feedback.reason

    else:
        # 分解模式：LLM将goal分解为子任务，串行递归执行
        # 每个子任务的goal.md包含三段：做什么、输出什么、为什么需要这个输出
        subgoals = decompose(context, goal)
        for subgoal in subgoals:
            meta_agent(subgoal, depth+1)
            # 子任务完成后立即追加到当前节点context.md
            # 后续兄弟任务probe时自然订阅，无需显式传递
            append_to_parent_context(subgoal.observation)

    # 唯一的信息流动：无论成败，observation写入父节点context.md
    append_to_parent_context(observation)

    # 根节点例外：没有父节点，observation写入results.md供用户查看
    if depth == 0:
        write_results(observation)
```

---

## 具体改动清单

### 1. 删除 results.md（非根节点）

**现状**：每个节点都写 results.md，包含 status/result/console/observations 四个区块。

**改动**：
- 非根节点不再写 results.md
- 根节点保留 results.md，内容为最终 observation，供用户查看
- 删除 `write_results_completed()`、`write_results_escalated()`、`parse_results_content()`、`_results_text_format()`、`_merge_console_into_results()` 等所有围绕非根节点 results.md 的读写函数
- `merge_results()` 函数删除，分解模式不再需要汇总子节点 results.md

### 2. 删除 Recovery 机制

**现状**：`recover()` 函数扫描目录树，读取每个节点的 results.md status 和 meta.json decomposition_id，决定哪些节点需要重跑。

**改动**：
- 删除 `recovery.py` 整个文件
- 删除 `agent.py` 中 `run_agent()` 的 `recover_mode` 参数和相关逻辑
- 删除 `main.py` 中 `--recover` 命令行参数
- 根节点的 results.md 是唯一终态，用户直接查看即可判断是否需要重跑

### 3. 简化 meta.json

**现状**：meta.json 包含 goal_id、parent_goal_id、depth、decomposition_id、status、retry_count、context_truncated、created_at、completed_at 九个字段，主要服务于 Recovery。

**改动**：
- 删除 meta.json，不再需要节点级状态记录
- 如果需要保留调试信息，只保留 depth 和 created_at 两个字段，写入后不再更新
- 删除 `_read_or_init_meta()`、`_write_meta()`、`update_meta_status()` 等函数

### 4. 重构 observation 的信息流

**现状**：observation 由 verifier 从 console 里提炼，写入 results.md 的 observations 区块，再由 `_append_observations_to_parent_context()` 追加到父节点 context.md。

**改动**：
- observation 改为由 script 主动 print，verifier 不再负责提炼信息
- script 的完整 stdout 即为 observation，直接追加到父节点 context.md
- verifier 只返回 `{"pass": bool, "reason": str}`，去掉 observations 字段
- 失败时，feedback.reason 作为 observation 写入父节点 context.md
- `_append_observations_to_parent_context()` 改为接收 observation 字符串直接写入，去掉从 results.md 读取的逻辑
- 去掉逐行去重逻辑，改为按子任务名称加标题追加，保持信息完整性

### 5. 重构直接执行模式（execute_with_verification）

**现状**：循环 MAX_VERIFY_RETRY 次，失败后更新 last_script/last_feedback 继续重试，循环结束没有显式 escalate。

**改动**：
- 保留一次重试机会处理 execution_error（script 执行本身报错）
- 两次都失败，observation 写为失败原因，直接返回，由父节点重新决策
- 去掉 `MAX_VERIFY_RETRY` 环境变量，在代码里写死重试一次的逻辑，语义清晰
- 去掉 `last_script`/`last_feedback` 的马尔可夫结构，改为：第一次失败的 feedback 注入第二次 LLMCall 的 context 即可
- verifier 解析函数 `parse_verifier_response()` 简化，去掉 failure_type/observations 字段

### 6. 重构分解执行模式（execute_decompose）

**现状**：先全部执行 level 内所有任务，再回头检查失败并重试，存在顺序问题。

**改动**：
- 每个子任务执行后立即调用 `append_to_parent_context(subgoal.observation)`，无论成败
- 去掉 level 内的批量重试逻辑，失败的子任务 observation（失败原因）已写入父节点 context.md，父节点在下一次决策时自然感知
- 去掉 `merge_results()` 调用
- 分解模式末尾不再调用 `append_to_parent_context`，子任务各自写入已覆盖

### 7. 重构 decomposer prompt

**现状**：子任务 description 只描述"做什么"。

**改动**：要求 decomposer 在每个子任务的 description 里固定包含三段：

```
## 任务
（做什么）

## 输出要求
（需要输出什么，具体到信息粒度，不是泛泛的"输出结果"）

## 输出用途
（下游哪个子任务会消费这个输出，用于做什么；
  若无下游子任务，写"输出给父节点用于最终结果"）
```

code_generator 读到 goal.md 的输出要求后，在 script 里主动 print 对应信息。

### 8. 重构 probe

**现状**：probe 读取目录结构、父节点 context、上次 results.md、memory hints，拼接成 context。

**改动**：
- 去掉读取上次 results.md 的逻辑（results.md 不再存在于非根节点）
- 去掉 memory hints（删除 Recovery 后 memory.jsonl 也不再维护）
- 保留：当前节点 goal.md + 父节点 context.md + 目录结构
- probe 退化为纯确定性操作，更简单

### 9. 简化 execute_decompose 的重试

**现状**：子节点 escalated 后，父节点在同层检查并重试最多 MAX_RETRY 次。

**改动**：
- 去掉子节点级别的重试循环
- 子节点失败的 observation（失败原因）已写入父节点 context.md
- 父节点在下一轮 decision 时，读到失败信息，自行决定重新分解或直接执行
- MAX_RETRY 环境变量删除

---

## 文件变动总览

| 文件 | 操作 |
|------|------|
| `agent.py` | 大幅简化，删除 meta.json 读写、recovery 调用、results.md 相关逻辑 |
| `executor.py` | 删除 merge_results、write_results_*、parse_results_content 等；简化 execute_with_verification 和 execute_decompose |
| `recovery.py` | 整个删除 |
| `probe.py` | 简化，去掉 results.md 和 memory 读取 |
| `prompts/decomposer.md` | 增加三段式结构要求 |
| `prompts/verifier.md` | 简化，只输出 pass/reason，去掉 observations |
| `prompts/code_generator.md` | 增加：根据 goal.md 的输出要求，主动 print 对应信息 |
| `deps.py` | 不变 |
| `primitives.py` | 不变 |
| `logger.py` | 可简化：去掉 results.md 相关的 trace 事件 |
| `main.py` | 删除 --recover 参数 |

---

## 不变的部分

- 目录树即任务树的核心结构
- LLMCall 是唯一随机性入口
- script 在子进程中执行（script_runner.py），隔离崩溃
- 权限控制（permissions.json 向上查找）
- 全局 trace.jsonl 和 terminal.md 记录
- 深度限制（max_depth）作为硬性终止条件
- 子任务名称验证和清理逻辑

重要：要严格测试修改的正确性，完成修改后要记得更新README.m使得项目状态和描述一致。