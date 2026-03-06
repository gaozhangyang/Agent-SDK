"""
测试 probe 模块
"""

import os
import sys
import tempfile
import shutil
import unittest
from unittest.mock import Mock, patch, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from probe import (
    get_directory_tree,
    get_memory_hint,
    write_context,
    probe,
)


class TestProbeHelpers(unittest.TestCase):
    """测试 probe 辅助函数"""

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.node_dir = os.path.join(self.temp_dir, "test_node")
        os.makedirs(self.node_dir)

        self.mock_logger = Mock()

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def test_get_directory_tree(self):
        """测试获取目录树"""
        # 创建测试文件
        with open(os.path.join(self.node_dir, "test.md"), "w") as f:
            f.write("test")

        result = get_directory_tree(self.node_dir)

        self.assertIsInstance(result, str)
        self.assertIn("test.md", result)

    def test_get_memory_hint_empty(self):
        """测试空记忆"""
        self.mock_logger.get_recent_memory = Mock(return_value=[])

        result = get_memory_hint(self.mock_logger)

        self.assertEqual(result, "")

    def test_get_memory_hint_with_data(self):
        """测试带数据的记忆"""
        self.mock_logger.get_recent_memory = Mock(
            return_value=[
                {
                    "task_type": "test",
                    "goal_summary": "test goal",
                    "reliability": 0.9,
                    "depth_used": 2,
                }
            ]
        )

        result = get_memory_hint(self.mock_logger)

        self.assertIn("test", result)

    def test_write_context(self):
        """测试写入 context"""
        context = "test context"

        write_context(self.node_dir, context)

        context_path = os.path.join(self.node_dir, "context.md")
        self.assertTrue(os.path.exists(context_path))

        with open(context_path, "r") as f:
            content = f.read()

        self.assertEqual(content, context)

    def test_write_context_creates_directory(self):
        """测试写入 context 创建目录"""
        subdir = os.path.join(self.node_dir, "subdir")

        write_context(subdir, "context")

        self.assertTrue(os.path.exists(os.path.join(subdir, "context.md")))


class TestProbeIntegration(unittest.TestCase):
    """测试 probe 集成"""

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.node_dir = os.path.join(self.temp_dir, "test_node")
        os.makedirs(self.node_dir)

        # 创建 goal.md
        with open(os.path.join(self.node_dir, "goal.md"), "w") as f:
            f.write("Test goal")

        self.mock_logger = Mock()

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def test_probe_deterministic(self):
        """测试 probe 确定性操作"""
        # 创建子目录
        subdir = os.path.join(self.node_dir, "subdir")
        os.makedirs(subdir)

        # 创建 results.md (retry 场景)
        with open(os.path.join(self.node_dir, "results.md"), "w") as f:
            f.write("status: completed\n\n--- result ---\ntest result")

        result = probe(self.node_dir, "Test goal", {}, self.mock_logger, depth=0)

        # 验证返回了 context
        self.assertIsInstance(result, str)

        # 验证写入了 context.md
        context_path = os.path.join(self.node_dir, "context.md")
        self.assertTrue(os.path.exists(context_path))

    def test_probe_with_depth(self):
        """测试带深度的 probe（子节点场景）"""
        # 创建父节点 context
        parent_context_path = os.path.join(self.temp_dir, "context.md")
        with open(parent_context_path, "w") as f:
            f.write("Parent context")

        result = probe(self.node_dir, "Test goal", {}, self.mock_logger, depth=1)

        self.assertIsInstance(result, str)
        # 应该有父节点 context
        self.assertIn("Parent context", result)

    def test_probe_without_previous_results(self):
        """测试没有上次结果的情况"""
        result = probe(self.node_dir, "Test goal", {}, self.mock_logger, depth=0)

        self.assertIsInstance(result, str)
        # 新的probe实现返回目录结构
        self.assertIn("Directory structure", result)


if __name__ == "__main__":
    unittest.main()
