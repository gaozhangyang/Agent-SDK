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
    get_file_sizes,
    get_memory_hint,
    parse_json_response,
    check_file_readable,
    write_context,
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

    def test_get_file_sizes(self):
        """测试获取文件大小"""
        test_file = os.path.join(self.node_dir, "test.txt")
        with open(test_file, "w") as f:
            f.write("test content")

        result = get_file_sizes(self.node_dir)

        self.assertIsInstance(result, str)

    def test_get_memory_hint_empty(self):
        """测试空记忆"""
        self.mock_logger.get_recent_memory = Mock(return_value=[])

        result = get_memory_hint(self.mock_logger)

        self.assertEqual(result, "No previous memory available.")

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

    def test_parse_json_response_valid(self):
        """测试解析有效 JSON"""
        content = '{"key": "value"}'

        result = parse_json_response(content)

        self.assertEqual(result, {"key": "value"})

    def test_parse_json_response_in_text(self):
        """测试解析文本中的 JSON"""
        content = 'Some text {"key": "value"} more text'

        result = parse_json_response(content)

        self.assertIsNotNone(result)

    def test_parse_json_response_invalid(self):
        """测试解析无效 JSON"""
        content = "not json"

        result = parse_json_response(content)

        self.assertIsNone(result)

    def test_check_file_readable_allowed(self):
        """测试允许读取文件"""
        test_file = os.path.join(self.node_dir, "test.txt")
        with open(test_file, "w") as f:
            f.write("test")

        permissions = {"read": ["./"]}

        result = check_file_readable(test_file, self.node_dir, permissions)

        self.assertTrue(result)

    def test_check_file_readable_denied(self):
        """测试拒绝读取文件"""
        test_file = "/tmp/test_read.txt"

        permissions = {"read": []}

        result = check_file_readable(test_file, self.node_dir, permissions)

        self.assertFalse(result)

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

    @patch("probe.make_primitives")
    def test_ask_llm_for_files(self, mock_make_primitives):
        """测试询问 LLM 需要读取的文件"""
        from probe import ask_llm_for_files

        mock_llm = Mock(return_value='{"files_by_priority": []}')
        mock_primitives = {"llm_call": mock_llm}
        mock_make_primitives.return_value = mock_primitives

        result = ask_llm_for_files(
            tree="tree",
            sizes="sizes",
            memory="memory",
            goal="goal",
            permissions={},
            logger=self.mock_logger,
            node_dir=self.node_dir,
        )

        self.assertIsInstance(result, list)

    def test_pull_files_with_budget_empty(self):
        """测试拉取空文件列表"""
        from probe import pull_files_with_budget

        result, truncated = pull_files_with_budget([], {}, self.node_dir)

        self.assertIsInstance(result, str)


if __name__ == "__main__":
    unittest.main()
