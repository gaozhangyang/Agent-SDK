Generate a Python script to aggregate results from subtasks and answer the original goal. Output only one ```python ... ``` block; do not output <tool_code> or any tool markup.

Original goal:
{goal}

Subtasks to aggregate:
{subtasks_info}

The script should:
1. Read each subtask's results.md file (using read(path))
2. Call llm_call() to synthesize all results into a final answer
3. Write the final result to {goal_dir}/results.md in JSON format:
   {{"status": "completed", "result": "..."}}

Available in the script: read(path), write(path, content), bash(command), llm_call(context, prompt). Do not output tool invocations—only the Python script.
