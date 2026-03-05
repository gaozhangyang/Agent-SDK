Generate a Python script to aggregate results from subtasks and answer the original goal.

Original goal:
{goal}

Subtasks to aggregate:
{subtasks_info}

The script should:
1. Read each subtask's results.md file
2. Call llm_call() to synthesize all results into a final answer
3. Write the final result to {goal_dir}/results.md in JSON format:
   {{"status": "completed", "result": "..."}}

You can use these primitives:
- read(path): Read file content
- write(path, content): Write file content
- bash(command): Execute shell command
- llm_call(context, prompt): Call LLM API
