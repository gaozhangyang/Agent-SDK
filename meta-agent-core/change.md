之前运行/survey_agent_python项目的轨迹存在survey_agent_python/.agent，帮我发现meta-agent-core工作时的bug并修复,目前已经发现的问题包括:

# Agent 运行轨迹问题分析与修改建议

> 基于 trace.jsonl 实际运行轨迹，对照 AGENT.md 设计规范进行分析。




---

## LLM 在 Execute 阶段仅输出文本描述，未产生 `<invoke>` 工具调用

> 本问题来自第二轮修复后的 trace（seq 37 之后）。

**现象**

修复问题一至六后，新 trace 中 Recovery→Collect→Plan 流程已正常运转：
- seq 37：Collect 重新触发，上下文完整注入；
- uncertainty.score 从 0.8 降至 0.2，JSON 解析恢复正常；
- Reason 阶段产出了合理的执行计划。

但在 Execute 阶段，LLM 的输出仅包含**自然语言描述**（如"我将执行以下步骤：1. 抓取论文 2. 筛选论文 3. 生成总结"），而没有任何 `<invoke name="Bash">` 或 `<invoke name="Read">` 格式的工具调用标签。框架接收到空工具调用列表，Judge 判定任务未推进，再次进入 Recovery 循环。

**根本原因分析**

问题一的修复（要求 LLM「先输出 JSON，再输出工具调用」）改变了提示结构，但新的 prompt 对 Execute 阶段的指令可能产生了混淆：LLM 将 Execute 阶段也理解成了「只需输出推理/计划文本」的阶段，而不是「必须产出 `<invoke>` 格式的可执行调用」。两个阶段的提示边界模糊，导致 LLM 在两个阶段都输出了文本，而在需要工具调用的阶段没有产生工具调用。

**修改建议**

1. **严格区分 Reason 阶段和 Execute 阶段的 prompt 模板**，二者不能共用同一套指令：
   - Reason 阶段：只要求输出结构化 JSON（含计划、uncertainty 等），明确**禁止**输出 `<invoke>` 标签。
   - Execute 阶段：只要求输出 `<invoke>` 工具调用，明确**禁止**输出 JSON 或自然语言计划描述。

2. **在 Execute 阶段的 system prompt 中增加强制性约束**，例如：

   ```
   你现在处于 Execute 阶段。
   你必须且只能输出 <invoke> 格式的工具调用。
   不要输出任何解释、计划或 JSON。
   如果你没有任何工具调用要执行，输出：<invoke name="Noop"></invoke>
   ```

3. **增加 Execute 阶段的输出验证**：框架在接收到 Execute 输出后，若检测到工具调用列表为空且输出内容为纯文本，应立即识别为 `format_error`，向 LLM 发送一条纠正消息（如「你的上一次输出没有包含任何 `<invoke>` 调用，请重新输出工具调用」），而不是直接进入 Judge→Recovery 大循环，以节省迭代次数。

4. **引入 Noop 工具**：当 LLM 确实没有任何工具需要执行时（例如 Plan 阶段已完成所有分析，无需额外信息收集），允许输出一个空操作 `<invoke name="Noop"></invoke>` 作为合法的工具调用，避免框架将「无工具调用」误判为格式错误。

---



调试survey_agent_python/run.py并观察新存放在survey_agent_python/.agent下的terminal.md和trace.jsonl，发现新问题、解决问题，直到没有问题为止。


最后完成工作之后要更新所有相关的README.md文档和survey_agent_python/.agent/AGENT.md(只做必要的修改)，使得项目状态与描述一致。



