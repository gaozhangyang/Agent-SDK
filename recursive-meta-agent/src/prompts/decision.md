Analyze this task and decide whether to solve it directly or decompose it into subtasks.

Goal:
{goal}

Context:
{context}

Return a JSON object:
{{"type": "direct"}} - if the task is simple enough to solve directly
{{"type": "decompose", "subtasks": [{{"name": "subtask1", "description": "..."}}]}} - if the task needs to be broken down

Consider:
- Is the task complex enough to benefit from decomposition?
- Can the task be easily broken into independent subtasks?
- What is the max depth allowed? (from permissions)
