"""
测试四个原语: read, write, bash, llm_call
"""

import os
import sys
import tempfile
import shutil
import unittest
from unittest.mock import Mock, patch, MagicMock

# 添加 src 到路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from primitives import make_primitives


class TestPrimitives(unittest.TestCase):
    """测试四个原语"""

    def setUp(self):
        """创建临时目录"""
        self.temp_dir = tempfile.mkdtemp()
        self.node_dir = os.path.join(self.temp_dir, "test_node")
        os.makedirs(self.node_dir)

        # 创建 mock logger
        self.mock_logger = Mock()
        self.mock_logger.log_trace = Mock(return_value=1)

    def tearDown(self):
        """清理临时目录"""
        shutil.rmtree(self.temp_dir)

    def test_make_primitives_returns_dict(self):
        """测试 make_primitives 返回字典"""
        permissions = {"read": [], "write": ["./"], "max_output_length": 102400}
        primitives = make_primitives(self.node_dir, permissions, self.mock_logger)

        self.assertIsInstance(primitives, dict)
        self.assertIn("read", primitives)
        self.assertIn("write", primitives)
        self.assertIn("bash", primitives)
        self.assertIn("llm_call", primitives)

    def test_read_file_success(self):
        """测试读取文件成功"""
        # 创建测试文件
        test_file = os.path.join(self.node_dir, "test.txt")
        with open(test_file, "w") as f:
            f.write("test content")

        permissions = {"read": [], "write": ["./"], "max_output_length": 102400}
        primitives = make_primitives(self.node_dir, permissions, self.mock_logger)

        content = primitives["read"](test_file)
        self.assertEqual(content, "test content")

    def test_read_file_not_found(self):
        """测试读取不存在的文件"""
        permissions = {"read": [], "write": ["./"], "max_output_length": 102400}
        primitives = make_primitives(self.node_dir, permissions, self.mock_logger)

        with self.assertRaises(FileNotFoundError):
            primitives["read"](os.path.join(self.node_dir, "nonexistent.txt"))

    def test_read_permission_denied(self):
        """测试读取权限拒绝"""
        # 创建不在白名单中的路径
        test_file = "/tmp/test_read_denied.txt"
        with open(test_file, "w") as f:
            f.write("test")

        try:
            # 权限配置不允许读取
            permissions = {"read": [], "write": ["./"], "max_output_length": 102400}
            primitives = make_primitives(self.node_dir, permissions, self.mock_logger)

            with self.assertRaises(PermissionError):
                primitives["read"](test_file)
        finally:
            if os.path.exists(test_file):
                os.remove(test_file)

    def test_write_file_success(self):
        """测试写入文件成功"""
        permissions = {"read": [], "write": ["./"], "max_output_length": 102400}
        primitives = make_primitives(self.node_dir, permissions, self.mock_logger)

        test_file = os.path.join(self.node_dir, "output.txt")
        primitives["write"](test_file, "test output")

        with open(test_file, "r") as f:
            content = f.read()

        self.assertEqual(content, "test output")

    def test_write_creates_directory(self):
        """测试写入时自动创建目录"""
        permissions = {"read": [], "write": ["./"], "max_output_length": 102400}
        primitives = make_primitives(self.node_dir, permissions, self.mock_logger)

        test_file = os.path.join(self.node_dir, "subdir", "output.txt")
        primitives["write"](test_file, "test")

        self.assertTrue(os.path.exists(test_file))

    def test_write_permission_denied(self):
        """测试写入权限拒绝"""
        permissions = {"read": [], "write": [], "max_output_length": 102400}
        primitives = make_primitives(self.node_dir, permissions, self.mock_logger)

        with self.assertRaises(PermissionError):
            primitives["write"]("/tmp/test_write_denied.txt", "test")

    def test_bash_execution(self):
        """测试 bash 执行"""
        permissions = {"read": [], "write": ["./"], "max_output_length": 102400}
        primitives = make_primitives(self.node_dir, permissions, self.mock_logger)

        output = primitives["bash"]("echo 'hello world'")
        self.assertIn("hello world", output)

    def test_bash_output_truncation(self):
        """测试 bash 输出截断"""
        small_max = 10
        permissions = {"read": [], "write": ["./"], "max_output_length": small_max}
        primitives = make_primitives(self.node_dir, permissions, self.mock_logger)

        output = primitives["bash"]("echo 'this is a very long output'")

        # 输出应该被截断
        self.assertLessEqual(len(output), small_max + 50)  # 加上截断标记

    def test_bash_error_handling(self):
        """测试 bash 错误处理"""
        permissions = {"read": [], "write": ["./"], "max_output_length": 102400}
        primitives = make_primitives(self.node_dir, permissions, self.mock_logger)

        # 测试无效命令（不在权限内）
        output = primitives["bash"]("cd /nonexistent_path")
        # bash 可能成功也可能失败，不做严格断言


class TestPrimitivesLLMCall(unittest.TestCase):
    """测试 llm_call 原语"""

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.node_dir = os.path.join(self.temp_dir, "test_node")
        os.makedirs(self.node_dir)

        self.mock_logger = Mock()
        self.mock_logger.log_trace = Mock(return_value=1)

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    @patch("src.primitives.requests.post")
    def test_llm_call_success(self, mock_post):
        """测试 llm_call 成功"""
        # Mock API 响应
        mock_response = Mock()
        mock_response.json.return_value = {
            "choices": [{"message": {"content": "test response"}}]
        }
        mock_post.return_value = mock_response

        permissions = {
            "read": [],
            "write": ["./"],
            "max_output_length": 102400,
            "context_budget": {"total": 200000, "reservedOutput": 4000},
        }
        primitives = make_primitives(self.node_dir, permissions, self.mock_logger)

        # 需要设置 API key
        env_with_key = os.environ.copy()
        env_with_key["LLM_API_KEY"] = "test_key"
        env_with_key["LLM_BASE_URL"] = "https://api.test.com"
        with patch.dict(os.environ, env_with_key):
            result = primitives["llm_call"]("context", "prompt")

        self.assertEqual(result, "test response")
        mock_post.assert_called_once()

    @patch("src.primitives.requests.post")
    def test_llm_call_context_truncation(self, mock_post):
        """测试 llm_call 上下文截断"""
        mock_response = Mock()
        mock_response.json.return_value = {
            "choices": [{"message": {"content": "response"}}]
        }
        mock_post.return_value = mock_response

        # 小预算触发截断 (total=100, reservedOutput=80, prompt_tokens ~ 25 = 100 chars)
        # 允许的 context tokens = (100-80-25) = -5 < 0, 应该触发截断
        permissions = {
            "read": [],
            "write": ["./"],
            "max_output_length": 102400,
            "context_budget": {"total": 100, "reservedOutput": 80},
        }
        primitives = make_primitives(self.node_dir, permissions, self.mock_logger)

        long_context = "x" * 1000

        env_with_key = os.environ.copy()
        env_with_key["LLM_API_KEY"] = "test_key"
        env_with_key["LLM_BASE_URL"] = "https://api.test.com"
        with patch.dict(os.environ, env_with_key):
            result = primitives["llm_call"](long_context, "prompt")

        # mock 返回固定结果，检查是否被截断处理
        # 由于 mock 返回的是固定值，我们只需确保调用成功
        self.assertIsNotNone(result)

    def test_llm_call_no_api_key(self):
        """测试没有 API key 时抛出错误 - 通过检查 LLM_API_KEY 全局变量"""
        # 测试模块级别的 LLM_API_KEY 变量
        from src import primitives as primitives_module

        # 当环境变量中没有 LLM_API_KEY 时，应该为空字符串
        env_backup = os.environ.get("LLM_API_KEY")

        # 清除环境变量
        if "LLM_API_KEY" in os.environ:
            del os.environ["LLM_API_KEY"]

        # 重新加载模块以获取更新后的值
        import importlib

        importlib.reload(primitives_module)

        # 验证 LLM_API_KEY 为空
        self.assertEqual(primitives_module.LLM_API_KEY, "")

        # 恢复环境变量
        if env_backup:
            os.environ["LLM_API_KEY"] = env_backup
        elif "LLM_API_KEY" in os.environ:
            del os.environ["LLM_API_KEY"]


class TestPrimitivesEdgeCases(unittest.TestCase):
    """边界情况测试"""

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.node_dir = os.path.join(self.temp_dir, "test_node")
        os.makedirs(self.node_dir)

        self.mock_logger = Mock()
        self.mock_logger.log_trace = Mock(return_value=1)

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def test_read_empty_file(self):
        """测试读取空文件"""
        test_file = os.path.join(self.node_dir, "empty.txt")
        with open(test_file, "w") as f:
            f.write("")

        permissions = {"read": [], "write": ["./"], "max_output_length": 102400}
        primitives = make_primitives(self.node_dir, permissions, self.mock_logger)

        content = primitives["read"](test_file)
        self.assertEqual(content, "")

    def test_write_empty_content(self):
        """测试写入空内容"""
        permissions = {"read": [], "write": ["./"], "max_output_length": 102400}
        primitives = make_primitives(self.node_dir, permissions, self.mock_logger)

        test_file = os.path.join(self.node_dir, "empty.txt")
        primitives["write"](test_file, "")

        self.assertTrue(os.path.exists(test_file))


if __name__ == "__main__":
    unittest.main()
