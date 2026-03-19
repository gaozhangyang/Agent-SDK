import json
import os
import sys
import tempfile
import shutil
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from permissions import DEFAULT_PERMISSIONS, load_permissions


class TestPermissions(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.node_dir = os.path.join(self.temp_dir, "node")
        os.makedirs(self.node_dir)

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def test_load_permissions_default(self):
        permissions, directory = load_permissions(self.node_dir)
        self.assertEqual(permissions["max_depth"], DEFAULT_PERMISSIONS["max_depth"])
        self.assertEqual(directory, self.node_dir)

    def test_load_permissions_merges_bash(self):
        with open(os.path.join(self.temp_dir, "permissions.json"), "w", encoding="utf-8") as f:
            json.dump({"bash": {"network": True}, "max_depth": 2}, f)
        permissions, directory = load_permissions(self.node_dir)
        self.assertEqual(permissions["max_depth"], 2)
        self.assertTrue(permissions["bash"]["network"])
        self.assertFalse(permissions["bash"]["delete"])
        self.assertEqual(directory, self.temp_dir)


if __name__ == "__main__":
    unittest.main()
