Analyze this task and determine which files need to be read to understand the task.

Directory structure:
{tree}

File sizes:
{sizes}

Memory:
{memory}

Task goal:
{goal}

Return a JSON object with this format:
{{
    "files_by_priority": [
        {{"path": "file1.md", "priority": "high", "reason": "contains task description"}},
        {{"path": "file2.py", "priority": "medium", "reason": "contains implementation"}}
    ]
}}

Only include files that are relevant to solving this task. Priority levels: high, medium, low.
