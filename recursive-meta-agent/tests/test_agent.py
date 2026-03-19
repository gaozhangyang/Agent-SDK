import json
import os
import sys
import tempfile
import shutil
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from agent import make_decision, meta_agent, read_goal


class TestAgent(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.goal_dir = os.path.join(self.temp_dir, "goal")
        os.makedirs(self.goal_dir)
        with open(os.path.join(self.goal_dir, "goal.md"), "w", encoding="utf-8") as f:
            f.write("Test goal")

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def test_read_goal(self):
        self.assertEqual(read_goal(self.goal_dir), "Test goal")

    @patch("agent.make_decision", return_value={"type": "direct", "subtasks": []})
    @patch(
        "agent.execute_with_verification",
        return_value={
            "status": "success",
            "summary": "direct summary",
            "observation": "done",
            "direct_info": "answer=1",
            "indirect_files": [],
            "open_questions": [],
            "recommended_next_action": "finish",
            "retries": 0,
            "attempts": [],
        },
    )
    def test_meta_agent_direct_writes_artifact_and_results(self, *_):
        artifact = meta_agent(self.goal_dir)

        self.assertEqual(artifact["mode"], "direct")
        self.assertEqual(artifact["status"], "success")
        self.assertTrue(os.path.exists(os.path.join(self.goal_dir, "artifact.json")))
        self.assertTrue(os.path.exists(os.path.join(self.goal_dir, "results.md")))

    @patch(
        "agent.execute_decompose",
        return_value=[
            {"node": "1_child", "status": "success", "summary": "child summary"},
            {"node": "2_child", "status": "failed", "summary": "child failed"},
        ],
    )
    @patch(
        "agent.make_decision",
        return_value={
            "type": "decompose",
            "subtasks": [{"name": "child", "description": "desc", "depends_on": []}],
        },
    )
    def test_meta_agent_decompose_aggregates_children(self, *_):
        artifact = meta_agent(self.goal_dir)

        self.assertEqual(artifact["mode"], "decompose")
        self.assertEqual(artifact["status"], "failed")
        self.assertIn("child_summaries", artifact)

    @patch("primitives.make_primitives")
    def test_make_decision_defaults_to_direct_on_error(self, mock_make_primitives):
        mock_make_primitives.return_value = {"llm_call": lambda **_: (_ for _ in ()).throw(Exception("boom"))}
        result = make_decision("ctx", "goal", {}, object(), self.goal_dir)
        self.assertEqual(result["type"], "direct")


if __name__ == "__main__":
    unittest.main()
