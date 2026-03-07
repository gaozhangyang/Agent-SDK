Verify whether the execution result meets the original goal, and if not, revise the goal accordingly.

Original goal:
{original_goal}

Plan:
{plan}

Script executed:
{script}

Results written by script (check for RESULT: and OBSERVATIONS: in this output):
{console_output}

Return ONLY a valid JSON (no additional text) with the verification outcome:
```json
{
  "pass": true or false,
  "feedback": "失败原因的简短描述，pass 为 true 时留空"
}
```

The script writes "RESULT: ..." to indicate success or failure. If RESULT shows the task was completed, pass should be true. If RESULT shows "escalated" or indicates failure, pass should be false.
