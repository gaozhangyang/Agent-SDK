"""
测试 meta_agent 端到端集成
"""

import os
import sys
import tempfile
import shutil
import json
import unittest
from unittest.mock import Mock, patch, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from agent import (
    read_goal,
    read_or_init_meta,
    write_meta,
    make_decision,
    parse_decision,
    get_subtasks,
    parse_subtasks,
    DEFAULT_META,
)


class TestReadGoal(unittest.TestCase):
    """测试 read_goal"""

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.node_dir = os.path.join(self.temp_dir, "test_node")
        os.makedirs(self.node_dir)

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def test_read_goal_success(self):
        """测试读取目标成功"""
        goal_path = os.path.join(self.node_dir, "goal.md")
        with open(goal_path, "w") as f:
            f.write("Test goal")

        result = read_goal(self.node_dir)
        self.assertEqual(result, "Test goal")

    def test_read_goal_not_exists(self):
        """测试目标不存在"""
        result = read_goal(self.node_dir)
        self.assertEqual(result, "")


class TestReadOrInitMeta(unittest.TestCase):
    """测试 read_or_init_meta"""

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.node_dir = os.path.join(self.temp_dir, "test_node")
        os.makedirs(self.node_dir)

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def test_init_new_meta(self):
        """测试初始化新 meta"""
        meta = read_or_init_meta(self.node_dir)

        self.assertEqual(meta["status"], "not_started")
        self.assertEqual(meta["depth"], 0)
        self.assertEqual(meta["retry_count"], 0)
        self.assertIn("goal_id", meta)
        self.assertIn("created_at", meta)

    def test_read_existing_meta(self):
        """测试读取已存在的 meta"""
        existing_meta = {"goal_id": "existing-id", "status": "running", "depth": 2}
        meta_path = os.path.join(self.node_dir, "meta.json")
        with open(meta_path, "w") as f:
            json.dump(existing_meta, f)

        meta = read_or_init_meta(self.node_dir)

        self.assertEqual(meta["goal_id"], "existing-id")
        self.assertEqual(meta["status"], "running")


class TestWriteMeta(unittest.TestCase):
    """测试 write_meta"""

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.node_dir = os.path.join(self.temp_dir, "test_node")
        os.makedirs(self.node_dir)

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def test_write_meta(self):
        """测试写入 meta"""
        meta = {"status": "completed", "depth": 1}
        write_meta(self.node_dir, meta)

        meta_path = os.path.join(self.node_dir, "meta.json")
        with open(meta_path, "r") as f:
            result = json.load(f)

        self.assertEqual(result["status"], "completed")


class TestMakeDecision(unittest.TestCase):
    """测试 make_decision"""

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.node_dir = os.path.join(self.temp_dir, "test_node")
        os.makedirs(self.node_dir)

        self.mock_logger = Mock()
        self.mock_logger.log_trace = Mock(return_value=1)

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    @patch("primitives.make_primitives")
    def test_decision_direct(self, mock_make_primitives):
        """测试决策为 direct"""
        # Mock llm_call 返回 direct
        mock_llm = Mock(return_value='{"type": "direct"}')
        mock_primitives = {
            "llm_call": mock_llm,
            "read": Mock(),
            "write": Mock(),
            "bash": Mock(),
        }
        mock_make_primitives.return_value = mock_primitives

        permissions = {"max_depth": 4}

        result = make_decision(
            "context", "goal", permissions, self.mock_logger, self.node_dir
        )

        self.assertEqual(result, "direct")

    @patch("primitives.make_primitives")
    def test_decision_decompose(self, mock_make_primitives):
        """测试决策为 decompose"""
        mock_llm = Mock(return_value='{"type": "decompose"}')
        mock_primitives = {
            "llm_call": mock_llm,
            "read": Mock(),
            "write": Mock(),
            "bash": Mock(),
        }
        mock_make_primitives.return_value = mock_primitives

        permissions = {"max_depth": 4}

        result = make_decision(
            "context", "goal", permissions, self.mock_logger, self.node_dir
        )

        self.assertEqual(result, "decompose")

    @patch("primitives.make_primitives")
    def test_decision_default(self, mock_make_primitives):
        """测试决策默认"""
        mock_llm = Mock(side_effect=Exception("error"))
        mock_primitives = {
            "llm_call": mock_llm,
            "read": Mock(),
            "write": Mock(),
            "bash": Mock(),
        }
        mock_make_primitives.return_value = mock_primitives

        permissions = {"max_depth": 4}

        result = make_decision(
            "context", "goal", permissions, self.mock_logger, self.node_dir
        )

        self.assertEqual(result, "direct")


class TestParseDecision(unittest.TestCase):
    """测试 parse_decision"""

    def test_parse_direct(self):
        """测试解析 direct"""
        result = parse_decision('{"type": "direct"}')
        self.assertEqual(result["type"], "direct")

    def test_parse_decompose(self):
        """测试解析 decompose"""
        result = parse_decision('{"type": "decompose", "subtasks": []}')
        self.assertEqual(result["type"], "decompose")

    def test_parse_invalid_json(self):
        """测试解析无效 JSON"""
        result = parse_decision("not json")
        self.assertIsNone(result)


class TestGetSubtasks(unittest.TestCase):
    """测试 get_subtasks"""

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.node_dir = os.path.join(self.temp_dir, "test_node")
        os.makedirs(self.node_dir)

        self.mock_logger = Mock()
        self.mock_logger.log_trace = Mock(return_value=1)

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    @patch("primitives.make_primitives")
    def test_get_subtasks_success(self, mock_make_primitives):
        """测试获取子任务成功"""
        subtasks = [
            {"name": "task1", "description": "desc1", "depends_on": []},
            {"name": "task2", "description": "desc2", "depends_on": ["task1"]},
        ]
        mock_llm = Mock(return_value=json.dumps(subtasks))
        mock_primitives = {
            "llm_call": mock_llm,
            "read": Mock(),
            "write": Mock(),
            "bash": Mock(),
        }
        mock_make_primitives.return_value = mock_primitives

        permissions = {}

        result = get_subtasks(
            "context", "goal", permissions, self.mock_logger, self.node_dir
        )

        self.assertIsInstance(result, list)

    @patch("primitives.make_primitives")
    def test_get_subtasks_empty(self, mock_make_primitives):
        """测试获取空子任务"""
        mock_llm = Mock(return_value="invalid")
        mock_primitives = {
            "llm_call": mock_llm,
            "read": Mock(),
            "write": Mock(),
            "bash": Mock(),
        }
        mock_make_primitives.return_value = mock_primitives

        permissions = {}

        result = get_subtasks(
            "context", "goal", permissions, self.mock_logger, self.node_dir
        )

        self.assertEqual(result, [])


class TestParseSubtasks(unittest.TestCase):
    """测试 parse_subtasks"""

    def test_parse_list(self):
        """测试解析列表"""
        content = '[{"name": "task1"}, {"name": "task2"}]'
        result = parse_subtasks(content)
        self.assertIsInstance(result, list)
        self.assertEqual(len(result), 2)

    def test_parse_dict_with_subtasks(self):
        """测试解析包含 subtasks 的字典"""
        content = '{"subtasks": [{"name": "task1"}]}'
        result = parse_subtasks(content)
        self.assertIsInstance(result, list)

    def test_parse_invalid(self):
        """测试解析无效内容"""
        result = parse_subtasks("not valid")
        self.assertIsNone(result)


class TestDefaultMeta(unittest.TestCase):
    """测试 DEFAULT_META"""

    def test_default_meta_structure(self):
        """测试默认 meta 结构"""
        self.assertIn("goal_id", DEFAULT_META)
        self.assertIn("parent_goal_id", DEFAULT_META)
        self.assertIn("depth", DEFAULT_META)
        self.assertIn("decomposition_id", DEFAULT_META)
        self.assertIn("status", DEFAULT_META)
        self.assertIn("retry_count", DEFAULT_META)
        self.assertIn("context_truncated", DEFAULT_META)
        self.assertIn("created_at", DEFAULT_META)
        self.assertIn("completed_at", DEFAULT_META)

    def test_default_meta_values(self):
        """测试默认 meta 值"""
        self.assertEqual(DEFAULT_META["status"], "not_started")
        self.assertEqual(DEFAULT_META["depth"], 0)
        self.assertEqual(DEFAULT_META["retry_count"], 0)
        self.assertFalse(DEFAULT_META["context_truncated"])


if __name__ == "__main__":
    unittest.main()
