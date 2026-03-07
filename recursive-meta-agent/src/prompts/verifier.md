Verify whether the execution result meets the original goal.

Original goal:
{original_goal}

Plan:
{plan}

Script executed:
{script}

Results written by script (check for RESULT: and OBSERVATIONS: in this output):
{console_output}

Return ONLY valid JSON, no additional text:
```json
{{
  "pass": true or false,
  "feedback": "简短描述失败原因，pass 为 true 时留空",
  "failure_type": "none" or "insufficient_context" or "execution_error" or "logic_error"
}}
```

Rules:
- If RESULT shows the task was completed successfully → pass: true, failure_type: "none"
- If RESULT shows "escalated", indicates failure, or output does not satisfy the goal → pass: false
- feedback must be specific enough for the next attempt to fix the issue

failure_type 判断标准：
- "insufficient_context"：脚本无法完成任务，因为缺少必要信息（文件路径未知、工具接口不清楚、需要先读取某些文档才能继续）。重试无法解决，需要先探索。
- "execution_error"：脚本逻辑正确，但执行时遇到偶发问题（网络超时、权限错误、文件不存在等）。重试可能解决。
- "logic_error"：脚本逻辑有误，修改脚本可以解决。重试可能解决。
- "none"：pass 为 true 时使用。