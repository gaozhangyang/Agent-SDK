import os
import sys
import tempfile
import shutil
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from executor import (
    append_to_parent_context,
    build_decompose_artifact,
    build_direct_artifact,
    execute_script,
    parse_observer_response,
    parse_script,
    sanitize_subtask_name,
)


class TestExecutor(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.goal_dir = os.path.join(self.temp_dir, "node")
        os.makedirs(self.goal_dir)

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def test_parse_script_from_code_block(self):
        result = parse_script("```python\nprint('x')\n```")
        self.assertEqual(result, "print('x')")

    def test_parse_observer_response_schema(self):
        result = parse_observer_response(
            '{"status":"success","summary":"ok","direct_info":"v=1","indirect_files":["a.txt"],"open_questions":[],"recommended_next_action":"finish"}'
        )
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["indirect_files"], ["a.txt"])

    def test_sanitize_subtask_name(self):
        self.assertEqual(sanitize_subtask_name("fetch papers"), "fetch_papers")

    def test_execute_script_runs_python_file(self):
        script_path = os.path.join(self.goal_dir, "script.py")
        with open(script_path, "w", encoding="utf-8") as f:
            f.write("print('hello')")
        result = execute_script(self.goal_dir, {}, Mock())
        self.assertIn("hello", result)

    def test_append_to_parent_context_writes_block(self):
        context_path = os.path.join(self.temp_dir, "context.md")
        with open(context_path, "w", encoding="utf-8") as f:
            f.write("# Root\n")
        append_to_parent_context(
            self.temp_dir,
            "1_child",
            {
                "status": "success",
                "mode": "direct",
                "summary": "child summary",
                "direct_info": "x=1",
                "indirect_files": [],
                "open_questions": [],
            },
            {},
        )
        with open(context_path, "r", encoding="utf-8") as f:
            content = f.read()
        self.assertIn("# From: 1_child", content)
        self.assertIn("x=1", content)

    def test_build_artifacts(self):
        direct = build_direct_artifact(
            self.goal_dir,
            "goal",
            {
                "status": "success",
                "summary": "ok",
                "observation": "done",
                "direct_info": "info",
                "indirect_files": [],
                "open_questions": [],
                "recommended_next_action": "finish",
                "retries": 0,
                "attempts": [],
            },
        )
        decompose = build_decompose_artifact(
            self.goal_dir,
            "goal",
            [{"node": "child", "status": "success", "summary": "done"}],
        )
        self.assertEqual(direct["mode"], "direct")
        self.assertEqual(decompose["mode"], "decompose")


if __name__ == "__main__":
    unittest.main()
