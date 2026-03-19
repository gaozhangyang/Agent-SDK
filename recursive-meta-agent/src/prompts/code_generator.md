Generate a Python script for the current node.

Current goal:
{current_goal}

Current node directory:
{goal_dir}

Attempt:
{attempt}

Previous error:
{previous_error}

Return exactly one Python code block:

```python
# script.py content
```

Rules:
- Top-level script only. Do not use `if __name__ == "__main__"`.
- The runtime injects `goal_dir` and sets the working directory to `goal_dir`.
- Use standard Python libraries unless the context explicitly requires something else.
- If this is not the first attempt, patch the previous failure instead of rewriting the task strategy blindly.
- Print observable facts. Prefer structured lines such as:
  - `[DONE] ...`
  - `[FAILED] ...`
  - `[DATA:<label>] <<< ... >>>`
- If you write a file that later tasks may need, print its path explicitly.
