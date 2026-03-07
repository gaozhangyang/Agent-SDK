"""
测试 Recovery 机制
"""

import os
import sys
import tempfile
import shutil
import json
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from recovery import (
    scan_tree,
    topological_order,
    read_meta,
    write_meta,
    escalate,
    get_node_status,
    check_node_completed,
    clean_node,
)


class TestScanTree(unittest.TestCase):
    """测试 scan_tree"""

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def test_scan_empty_tree(self):
        """测试扫描空树"""
        result = scan_tree(self.temp_dir)
        self.assertIn(self.temp_dir, result)

    def test_scan_with_nodes(self):
        """测试扫描有节点的树"""
        # 创建根节点
        root_goal = os.path.join(self.temp_dir, "goal.md")
        with open(root_goal, "w") as f:
            f.write("root goal")

        # 创建子节点
        subdir = os.path.join(self.temp_dir, "subtask1")
        os.makedirs(subdir)
        sub_goal = os.path.join(subdir, "goal.md")
        with open(sub_goal, "w") as f:
            f.write("sub goal")

        result = scan_tree(self.temp_dir)

        self.assertIn(self.temp_dir, result)
        self.assertIn(subdir, result)
        self.assertEqual(len(result), 2)

    def test_scan_nested_nodes(self):
        """测试扫描嵌套节点"""
        # 创建多层嵌套
        root_goal = os.path.join(self.temp_dir, "goal.md")
        with open(root_goal, "w") as f:
            f.write("root")

        sub1 = os.path.join(self.temp_dir, "sub1")
        os.makedirs(sub1)
        with open(os.path.join(sub1, "goal.md"), "w") as f:
            f.write("sub1")

        sub2 = os.path.join(sub1, "sub2")
        os.makedirs(sub2)
        with open(os.path.join(sub2, "goal.md"), "w") as f:
            f.write("sub2")

        result = scan_tree(self.temp_dir)

        self.assertEqual(len(result), 3)


class TestTopologicalOrder(unittest.TestCase):
    """测试 topological_order"""

    def test_single_node(self):
        """测试单节点"""
        nodes = ["/a/b"]
        result = topological_order(nodes)
        self.assertEqual(result, ["/a/b"])

    def test_multiple_depths(self):
        """测试多深度"""
        nodes = ["/root", "/root/sub1", "/root/sub1/sub2"]
        result = topological_order(nodes)

        # 按深度排序
        self.assertEqual(result[0], "/root")
        self.assertIn("/root/sub1", result)


class TestMetaOperations(unittest.TestCase):
    """测试 meta 操作"""

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.node_dir = os.path.join(self.temp_dir, "test_node")
        os.makedirs(self.node_dir)

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def test_read_meta_default(self):
        """测试读取默认 meta"""
        meta = read_meta(self.node_dir)

        self.assertEqual(meta["status"], "not_started")
        self.assertEqual(meta["depth"], 0)
        self.assertEqual(meta["retry_count"], 0)

    def test_read_meta_existing(self):
        """测试读取已存在的 meta"""
        meta = {"goal_id": "test-id", "status": "running", "depth": 2}
        meta_path = os.path.join(self.node_dir, "meta.json")
        with open(meta_path, "w") as f:
            json.dump(meta, f)

        result = read_meta(self.node_dir)

        self.assertEqual(result["goal_id"], "test-id")
        self.assertEqual(result["status"], "running")

    def test_write_meta(self):
        """测试写入 meta"""
        meta = {"status": "completed", "depth": 1}
        write_meta(self.node_dir, meta)

        meta_path = os.path.join(self.node_dir, "meta.json")
        with open(meta_path, "r") as f:
            result = json.load(f)

        self.assertEqual(result["status"], "completed")


class TestGetNodeStatus(unittest.TestCase):
    """测试 get_node_status"""

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.node_dir = os.path.join(self.temp_dir, "test_node")
        os.makedirs(self.node_dir)

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def test_status_not_started(self):
        """测试未开始状态"""
        result = get_node_status(self.node_dir)
        self.assertEqual(result, "not_started")

    def test_status_completed(self):
        """测试完成状态"""
        results_path = os.path.join(self.node_dir, "results.md")
        with open(results_path, "w") as f:
            json.dump({"status": "completed", "result": "test"}, f)

        result = get_node_status(self.node_dir)
        self.assertEqual(result, "completed")

    def test_status_failed(self):
        """测试失败状态"""
        # 现在不再使用 error.md，失败状态通过 results.md 的 status 字段判断
        results_path = os.path.join(self.node_dir, "results.md")
        with open(results_path, "w") as f:
            f.write("status: escalated\n\n--- result ---\nerror")

        result = get_node_status(self.node_dir)
        self.assertEqual(result, "escalated")

    def test_status_running(self):
        """测试运行中状态"""
        meta = {"status": "running"}
        with open(os.path.join(self.node_dir, "meta.json"), "w") as f:
            json.dump(meta, f)

        result = get_node_status(self.node_dir)
        self.assertEqual(result, "running")


class TestCheckNodeCompleted(unittest.TestCase):
    """测试 check_node_completed"""

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.node_dir = os.path.join(self.temp_dir, "test_node")
        os.makedirs(self.node_dir)

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def test_completed_true(self):
        """测试已完成返回 True"""
        results_path = os.path.join(self.node_dir, "results.md")
        with open(results_path, "w") as f:
            json.dump({"status": "completed"}, f)

        result = check_node_completed(self.node_dir)
        self.assertTrue(result)

    def test_failed_true(self):
        """测试失败返回 True"""
        # 现在不再使用 error.md，失败状态通过 results.md 判断
        results_path = os.path.join(self.node_dir, "results.md")
        with open(results_path, "w") as f:
            f.write("status: escalated\n\n--- result ---\nerror")

        result = check_node_completed(self.node_dir)
        self.assertTrue(result)

    def test_not_started_false(self):
        """测试未开始返回 False"""
        result = check_node_completed(self.node_dir)
        self.assertFalse(result)


class TestCleanNode(unittest.TestCase):
    """测试 clean_node"""

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.node_dir = os.path.join(self.temp_dir, "test_node")
        os.makedirs(self.node_dir)

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def test_clean_removes_files(self):
        """测试清理删除文件"""
        # 创建各种文件（不再包含 error.md）
        files = ["results.md", "context.md", "script.py"]
        for f in files:
            with open(os.path.join(self.node_dir, f), "w") as fp:
                fp.write("test")

        clean_node(self.node_dir)

        # 检查文件是否被删除
        for f in files:
            self.assertFalse(os.path.exists(os.path.join(self.node_dir, f)))

    def test_clean_updates_meta(self):
        """测试清理更新 meta"""
        meta = {"status": "failed"}
        with open(os.path.join(self.node_dir, "meta.json"), "w") as f:
            json.dump(meta, f)

        clean_node(self.node_dir)

        result = read_meta(self.node_dir)
        self.assertEqual(result["status"], "not_started")


if __name__ == "__main__":
    unittest.main()
