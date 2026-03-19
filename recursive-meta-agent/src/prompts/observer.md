Extract structured execution results for the runtime.

Input:
- Goal:
{goal}
- Script:
{script}
- Observation:
{observation}

Return valid JSON only:
```json
{{
  "status": "success | partial | failed",
  "summary": "One concise summary of what happened",
  "direct_info": "Information that a later script can use directly without re-reading a file",
  "indirect_files": ["path/to/file"],
  "open_questions": ["missing detail or unresolved issue"],
  "recommended_next_action": "finish | direct_retry | decompose"
}}
```

Rules:
- Mark `success` only when the goal appears completed from the observation.
- Put failure reasons in `direct_info`.
- `indirect_files` must contain file paths only.
- Keep `summary` concise and factual.
