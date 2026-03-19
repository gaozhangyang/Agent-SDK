import os
import sys
import tempfile
import shutil
import unittest
from unittest.mock import Mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from probe import get_directory_tree, probe, write_context


class TestProbe(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.parent_dir = os.path.join(self.temp_dir, "parent")
        self.goal_dir = os.path.join(self.parent_dir, "child")
        os.makedirs(self.goal_dir)
        with open(os.path.join(self.goal_dir, "goal.md"), "w", encoding="utf-8") as f:
            f.write("Test goal")

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def test_get_directory_tree(self):
        tree = get_directory_tree(self.goal_dir)
        self.assertIsInstance(tree, str)

    def test_write_context(self):
        write_context(self.goal_dir, "ctx")
        with open(os.path.join(self.goal_dir, "context.md"), "r", encoding="utf-8") as f:
            self.assertEqual(f.read(), "ctx")

    def test_probe_includes_goal(self):
        result = probe(self.goal_dir, "Test goal", {}, Mock(), depth=0)
        self.assertIn("# Goal", result)
        self.assertIn("Test goal", result)

    def test_probe_reads_parent_context(self):
        with open(os.path.join(self.parent_dir, "context.md"), "w", encoding="utf-8") as f:
            f.write("# Parent summary\nUseful context")
        result = probe(self.goal_dir, "Test goal", {}, Mock(), depth=1)
        self.assertIn("Useful context", result)


if __name__ == "__main__":
    unittest.main()
