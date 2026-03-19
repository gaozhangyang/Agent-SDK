import os
import sys
import tempfile
import shutil
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from agent_config import build_agent_context, load_agent_config


class TestAgentConfig(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.goal_dir = os.path.join(self.temp_dir, "goal")
        os.makedirs(os.path.join(self.temp_dir, ".agent"))
        os.makedirs(self.goal_dir)
        with open(
            os.path.join(self.temp_dir, ".agent", "AGENT.md"), "w", encoding="utf-8"
        ) as f:
            f.write(
                "# [all]\nmaxOutputLength: 123\ncontextBudget: {'total': 1000, 'reservedOutput': 200}\n\n# [decompose]\nmax_depth: 2\n\n# [learned_patterns]\nprefer explore-first\n"
            )

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def test_load_agent_config(self):
        config = load_agent_config(self.goal_dir)
        self.assertEqual(config["max_output_length"], 123)
        self.assertEqual(config["max_depth"], 2)
        self.assertEqual(config["context_budget"]["reserved_output"], 200)

    def test_build_agent_context(self):
        config = load_agent_config(self.goal_dir)
        context = build_agent_context(config, "planner")
        self.assertIn("max_depth", context)
        self.assertIn("prefer explore-first", context)


if __name__ == "__main__":
    unittest.main()
