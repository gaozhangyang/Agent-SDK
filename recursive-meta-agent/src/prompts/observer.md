Extract useful information from the execution result for subsequent tasks.

Input:
- Goal:
{goal}
- script content
{script}
- observation (script's complete stdout)
{observation}

Output:
Return ONLY valid JSON, no additional text:
```json
{{
  "direct_info": "Specific information that can be directly used in script, formatted as clear text",
  "indirect_files": ["path/to/file1", "path/to/file2"]
}}
```

Rules:
- direct_info: Only include directly usable specific values (e.g., API parameters, parsed config values, specific data that can be copied into a script). Do NOT include file paths.
- indirect_files: Only include file paths that point to information storage locations (files that subsequent tasks need to read). Examples:
  - File paths where results were written (e.g., "results written to data/selected_papers.json")
  - Directory locations containing configuration
- Combine with goal.md's "subsequent sibling tasks" section to determine which information is truly useful for subsequent tasks
- Failure information is also direct_info and should be written to direct_info (failure reason, error details)
- If no useful information found, return empty strings for both fields
