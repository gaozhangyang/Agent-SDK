之前运行/survey_agent_python项目的轨迹存在survey_agent_python/.agent，帮我发现meta-agent-core工作时的bug并修复,目前已经发现的问题包括:

# Agent 运行轨迹问题分析与修改建议

> 基于 trace.jsonl 实际运行轨迹，对照 AGENT.md 设计规范进行分析。

---

## 问题一：Reason 阶段 uncertainty.score 持续异常高（0.8）且 JSON 解析失败

**现象（seq 8、18、26）**

三次 `reason` 调用的 `uncertainty.score` 均为 `0.8`，且 `reasons` 字段均显示 `"JSON 解析失败"`。按照 AGENT.md 配置，`uncertaintyHigh` 阈值为 `0.85`，当前值虽未触发 Escalate，但已接近临界值，且连续失败说明 LLM 输出格式始终不符合预期结构。

**根本原因**

Reason 调用要求 LLM 返回结构化 JSON（含 `uncertainty.score`、`uncertainty.reasons` 等字段），但 LLM 实际返回的是自由文本夹杂 `<invoke>` XML 标签，导致 JSON 解析器无法解析。LLM 把「工具调用」和「推理输出」混在同一次响应里，违背了框架对输出格式的约定。

**修改建议**

1. 在 Reason 阶段的 system prompt 中明确要求 LLM **先输出结构化 JSON 推理结果，再（若有需要）输出工具调用**，或者将两者拆分为两次独立调用：一次 Reason（纯 JSON），一次 Execute（工具调用）。
2. 增加 JSON 解析的降级处理：解析失败时，不应直接将 `uncertainty.score` 默认设为 `0.8`（接近阈值），应设为一个明确的错误标识，并立即触发 Recovery 进行格式修正，而非继续执行工具调用。
3. 在 AGENT.md 的「输出格式要求」章节补充：Reason 阶段禁止在同一输出中混合 JSON 和 `<invoke>` 标签，二者必须分离。

---

## 问题二：Recovery 后 Collect 上下文丢失，LLM 在 Plan 阶段失去工作目录感知

**现象（seq 18、26）**

第一次 Recovery→Plan（seq 18）之后，LLM 尝试读取 `AGENT.md`（裸路径，无工作目录前缀）和 `skills/survey.py`（不存在的虚构文件）。第二次 Recovery→Plan（seq 26）又尝试读取 `survey_agent_python/AGENT.md` 和 `survey_agent_python/skills.yaml`（同样不存在）。

两次 Plan 阶段的 `input` 字段均为空（`Context:\n\nTask:...`），说明 Recovery 后 **Collect 阶段未被重新触发**，LLM 没有任何上下文支撑，只能凭「记忆」猜测文件路径。

**根本原因**

Recovery 流程（seq 15→16→17、seq 23→24→25）直接跳转到 Plan，但没有重新执行 Collect，导致下一轮 Plan 的 Context 为空。对比初始启动时（seq 7），Collect 是单独的一步且带有完整的 sources 配置。Recovery 路径遗漏了这一步。

**修改建议**

1. 在 Recovery→Plan 的状态转换中，**强制重新执行 Collect**，复用初始启动时的 collectConfig，确保 Plan 阶段始终有完整上下文。
2. 运行时框架应在每次进入 Plan 之前检查 Context 是否为空，若为空则先触发 Collect 而不是直接进行 Reason。
3. AGENT.md 中应明确声明：Recovery 后必须重新 Collect，不可跳过。

---

## 问题三：LLM 在 Plan 阶段产生幻觉，读取不存在的文件

**现象（seq 18、26）**

- seq 18：`Read` 调用 `skills/survey.py`——该文件在项目结构中从未存在。
- seq 26：`Read` 调用 `survey_agent_python/skills.yaml`——同样不存在。

这是上下文丢失（问题二）的直接后果：LLM 在没有任何 Collect 上下文的情况下，凭推断构造了错误路径，且没有在 Plan 阶段进行任何路径验证。

**修改建议**

1. 在 Execute 阶段对 `Read` 操作增加**路径预检**：执行前先验证文件是否存在，若不存在，将错误反馈给 Reason 而非直接执行并等到 Review 才发现。
2. Plan 阶段 Reason 的 system prompt 中应注入当前工作目录的文件列表（或至少注入关键路径列表），让 LLM 只能引用已知存在的文件。
3. 对于连续两次出现 `ENOENT` 错误的情况，error_classifier 应将其识别为 `logic` 类错误（LLM 推理问题），而非 `environment` 类错误，从而触发不同的 Recovery 策略（如强制重新注入上下文，而非简单重试）。

---

## 问题四：第一次 Execute 执行了多余的重复操作（重读已有上下文）

**现象（seq 8、10、11）**

第一轮 Reason（seq 8）给出的 Plan 是：先 `ls -la`，再 `cat .agent/AGENT.md | head -100`。但 AGENT.md 的内容已经通过 Collect（seq 7）完整注入到上下文中，LLM 完全不需要再次读取。这两步操作属于**无效冗余**，消耗了一次完整的 Plan→Execute→Review 迭代而没有推进任务。

**修改建议**

1. Reason 阶段的 system prompt 应明确提示 LLM：**Collect 上下文中已包含的文件内容无需再次 Read**，避免重复读取。
2. 或者在 Execute 前增加「计划有效性检查」：若 Plan 中的所有操作仅是读取 Collect 已提供的文件，则判定为无效计划，要求 LLM 重新规划。

---

## 问题五：Escalate 被触发时机过早，maxNoProgress 配置与实际不符

**现象（seq 31、32）**

AGENT.md 配置中 `maxNoProgress` 为 `3`（阈值配置说明表格中的默认值），但实际在第 3 次 Judge 判定为「否」后立即触发了 Escalate（`连续无增益，超出上限`）。然而，阈值配置说明表格中标注的默认值为 `10`，与运行时配置 JSON 中的 `maxNoProgress: 3` 存在**文档与配置不一致**。

此外，3 次迭代均因 Collect 上下文缺失（问题二）和文件路径错误（问题三）导致失败，属于**可修复的系统性问题**，不应直接 Escalate，而应先尝试修复上下文。

**修改建议**

1. **统一文档与配置**：将 AGENT.md 阈值说明表格中 `maxNoProgress` 的默认值从 `10` 改为 `3`（与运行时配置 JSON 保持一致），或反之，选定一个值后两处保持同步。
2. Escalate 前应区分失败类型：若连续失败均为同一类 `logic` 或 `environment` 错误，应先执行**针对性的 Recovery**（如重新注入 Collect 上下文），而不是直接 Escalate。
3. 可在 Recovery 策略中增加「强制重置上下文并重试」作为 Escalate 前的最后一步。

---

## 问题六：Read 工具的 `file_path` 参数名与 AGENT.md 定义不符

**现象（seq 18、20、26、28）**

Recovery 后 LLM 使用 `<invoke name="Read"><parameter name="file_path">` 进行文件读取，而 AGENT.md「输出格式要求」章节定义的参数名为 `path`（`<parameter name="path">`）。

**修改建议**

1. 框架应对参数名做**别名兼容**处理（同时支持 `path` 和 `file_path`），避免因参数名小差异导致工具调用静默失败。
2. 或者在 system prompt 中重申正确的参数名，并在解析时对错误参数名给出明确的错误提示，而非简单的 `ENOENT`（文件不存在），以便 LLM 能区分「路径错」还是「参数名错」。

---

## 总结

| # | 问题 | 严重程度 | 影响 |
|---|------|----------|------|
| 1 | Reason 输出 JSON 解析持续失败 | 高 | 导致 uncertainty 虚高，推理结果不可信 |
| 2 | Recovery 后 Collect 上下文丢失 | 高 | 根本原因，导致后续所有 Plan 失效 |
| 3 | LLM 在无上下文时产生路径幻觉 | 高 | 直接导致 Read 失败、任务无法推进 |
| 4 | 第一轮 Plan 重复读取已有上下文 | 中 | 浪费一次完整迭代 |
| 5 | maxNoProgress 文档与配置不一致，Escalate 过早 | 中 | 任务本可修复却被提前终止 |
| 6 | Read 工具参数名与规范不符 | 低 | 增加调试难度，错误信息误导 |


调试survey_agent_python/run.py并观察新存放在survey_agent_python/.agent下的terminal.md和trace.jsonl，发现新问题、解决问题，直到没有问题为止。


最后完成工作之后要更新所有相关的README.md文档和survey_agent_python/.agent/AGENT.md(只做必要的修改)，使得项目状态与描述一致。

