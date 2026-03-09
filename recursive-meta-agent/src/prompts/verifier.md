Verify whether the execution result meets the original goal.

Original goal:
{original_goal}

Plan:
{plan}

Script executed:
{script}

Console output (script's stdout):
{console_output}

Return ONLY valid JSON, no additional text:
```json
{{
  "pass": true or false,
  "reason": "简短描述失败原因，pass 为 true 时留空"
}}
```

Rules:
- 如果 console_output 显示任务成功完成 → pass: true
- 如果 console_output 显示失败 → pass: false
- reason 必须足够具体，以便下次尝试修复问题
- 失败时，reason 本身作为 observation 写入父节点 context.md
