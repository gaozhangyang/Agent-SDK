Break down this task into subtasks.

Goal:
{goal}

Context:
{context}

Return a JSON array of subtasks:
[
    {{"name": "subtask1", "description": "description of subtask 1", "depends_on": []}},
    {{"name": "subtask2", "description": "description of subtask 2", "depends_on": ["subtask1"]}}
]

IMPORTANT: Each subtask name MUST:
- Only contain letters, numbers, underscores, and hyphens (a-z, A-Z, 0-9, _, -)
- NOT contain spaces, slashes, colons, or any special characters
- Be unique within the list
- Example good names: "fetch_papers", "screen-results", "write_summary"
- Example bad names: "fetch papers", "screen/results", "write:summary"

Example:
[
    {{"name": "fetch_papers", "description": "Fetch papers from arXiv", "depends_on": []}},
    {{"name": "screen_papers", "description": "Screen papers for relevance", "depends_on": ["fetch_papers"]}},
    {{"name": "write_summary", "description": "Write summary", "depends_on": ["screen_papers"]}}
]

{dependency_error}