"""
测试 primitives：仅保留 llm_call（供 meta-agent 内部使用）
"""

import os
import sys
import tempfile
import shutil
import unittest
from unittest.mock import Mock, patch, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from primitives import make_primitives, MAX_RETRY


class TestMakePrimitives(unittest.TestCase):
    """测试 make_primitives 仅返回 llm_call"""

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.node_dir = os.path.join(self.temp_dir, "test_node")
        os.makedirs(self.node_dir)
        self.mock_logger = Mock()
        self.mock_logger.log_trace = Mock(return_value=1)

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def test_make_primitives_returns_dict_with_llm_call(self):
        permissions = {"context_budget": {"total": 200000, "reservedOutput": 4000}}
        primitives = make_primitives(self.node_dir, permissions, self.mock_logger)
        self.assertIsInstance(primitives, dict)
        self.assertIn("llm_call", primitives)
        self.assertEqual(set(primitives.keys()), {"llm_call"})


class TestLLMCall(unittest.TestCase):
    """测试 llm_call"""

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.node_dir = os.path.join(self.temp_dir, "test_node")
        os.makedirs(self.node_dir)
        self.mock_logger = Mock()
        self.mock_logger.log_trace = Mock(return_value=1)

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    @patch("openai.OpenAI")
    def test_llm_call_success(self, mock_openai_class):
        mock_client = MagicMock()
        mock_openai_class.return_value = mock_client
        mock_client.chat.completions.create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content="test response"))]
        )

        permissions = {"context_budget": {"total": 200000, "reservedOutput": 4000}}
        primitives = make_primitives(self.node_dir, permissions, self.mock_logger)

        with patch.dict(os.environ, {"LLM_API_KEY": "test_key"}, clear=False):
            result = primitives["llm_call"]("context", "prompt")

        self.assertEqual(result, "test response")
        mock_client.chat.completions.create.assert_called_once()

    def test_llm_call_no_api_key(self):
        permissions = {"context_budget": {"total": 200000, "reservedOutput": 4000}}
        primitives = make_primitives(self.node_dir, permissions, self.mock_logger)

        with patch.dict(os.environ, {}, clear=True):
            if "LLM_API_KEY" in os.environ:
                del os.environ["LLM_API_KEY"]
            with self.assertRaises(ValueError) as ctx:
                primitives["llm_call"]("context", "prompt")
            self.assertIn("LLM_API_KEY", str(ctx.exception))


class TestMAXRetry(unittest.TestCase):
    def test_max_retry_exported(self):
        self.assertIsInstance(MAX_RETRY, int)
        self.assertGreaterEqual(MAX_RETRY, 1)


if __name__ == "__main__":
    unittest.main()
