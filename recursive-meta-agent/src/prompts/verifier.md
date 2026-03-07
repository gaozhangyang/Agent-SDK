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
  "feedback": "简短描述失败原因，pass 为 true 时留空"
}}
```

Rules:
- If RESULT shows the task was completed successfully → pass: true
- If RESULT shows "escalated", indicates failure, or output does not satisfy the goal → pass: false
- feedback must be specific enough for the next attempt to fix the issue
- Do NOT include revised_goal or any other fields