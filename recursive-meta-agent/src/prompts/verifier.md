Verify whether the execution result meets the original goal.

Original goal:
{original_goal}

Plan:
{plan}

Script executed:
{script}

Results (包含 result + console):
{console_output}

Return ONLY valid JSON, no additional text:
```json
{{
  "pass": true or false,
  "feedback": "简短描述失败原因，pass 为 true 时留空",
  "failure_type": "none" or "insufficient_context" or "execution_error" or "logic_error",
  "observations": "从 console 原始数据中提炼出的具体信息，直接写入父节点 context.md"
}}
```

## observations 的写作规范

**observations 的本质**：从 console 原始数据中提炼出对父节点解决问题有用的具体信息，直接写入父节点 context.md。

**不是**描述执行了什么操作，**而是**从数据中提取出可直接使用的具体细节。

### 内容要求

**1. 已获取的有效信息**（精确到可直接被 LLM 使用的文本细节，无需额外工具调用或代码操作）
- ✅ `topics: ['Computer_Vision', 'NLP_and_LLM', 'Reinforcement_Learning']`
- ✅ `screening_threshold: 0.6，fetch_max_papers: 10`
- ✅ `知识库路径格式: knowledge_base/{{topic}}/meta.json`
- ❌ `成功读取了 AGENT.md 文件`（没有提炼出可直接使用的内容）
- ❌ `AGENT.md 中包含 topics 配置`（仍需额外操作才能获取具体值）

**2. 失败的具体原因**（为什么这个方式行不通）
- ✅ `topics 提取失败：代码按行遍历无法处理 JSON embedded in Markdown 的格式`
- ❌ `topics 格式未知，提取失败`

**3. 下一步建议**（仅 pass 为 false 时）
- ✅ `需用 llm_call 直接阅读 AGENT.md 原文提取 topics，而非代码解析`

### 示例：pass 为 true 时
```json
{{
  "pass": true,
  "feedback": "",
  "failure_type": "none",
  "observations": "- topics 共 3 个：Computer_Vision（cs.CV）、NLP_and_LLM（cs.CL, cs.LG）、Reinforcement_Learning（cs.LG, cs.AI）\n- screening_threshold: 0.6，fetch_max_papers: 10\n- 知识库路径格式：knowledge_base/{{topic}}/meta.json"
}}
```

### 示例：pass 为 false 时
```json
{{
  "pass": false,
  "feedback": "topics 提取失败，代码无法处理 JSON embedded in Markdown 格式",
  "failure_type": "logic_error",
  "observations": "- AGENT.md 已确认存在，内容完整可读\n- topics 提取失败：代码按行遍历无法处理 JSON embedded in Markdown 格式，结果条目数为 0\n- 下一步：需用 llm_call 直接阅读 AGENT.md 原文提取 topics"
}}
```

Rules:
- 如果 result 显示任务成功完成 → pass: true, failure_type: "none"
- 如果 result 显示 "escalated"、表示失败或不满足目标 → pass: false
- feedback 必须足够具体，以便下次尝试修复问题

failure_type 判断标准：
- "insufficient_context"：脚本无法完成任务，因为缺少必要信息（文件路径未知、工具接口不清楚、需要先读取某些文档才能继续）。重试无法解决，需要先探索。
- "execution_error"：脚本逻辑正确，但执行时遇到偶发问题（网络超时、权限错误、文件不存在等）。重试可能解决。
- "logic_error"：脚本逻辑有误，修改脚本可以解决。重试可能解决。
- "none"：pass 为 true 时使用。