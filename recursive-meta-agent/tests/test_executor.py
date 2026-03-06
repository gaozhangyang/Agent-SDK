"""
测试执行器
"""

import os
import sys
import tempfile
import shutil
import json
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from executor import (
    parse_script,
    execute_script,
    parse_results,
    parse_results_content,
    write_results_completed,
    write_results_escalated,
    update_meta_status,
)


class TestParseScript(unittest.TestCase):
    """测试 parse_script"""

    def test_parse_python_code_block(self):
        """测试解析 Python 代码块"""
        content = "```python\nprint('hello')\n```"
        result = parse_script(content)
        self.assertEqual(result.strip(), "print('hello')")

    def test_parse_generic_code_block(self):
        """测试解析通用代码块"""
        content = "```\nprint('hello')\n```"
        result = parse_script(content)
        self.assertEqual(result.strip(), "print('hello')")

    def test_parse_no_code_block(self):
        """测试无代码块"""
        content = "print('hello')"
        result = parse_script(content)
        self.assertEqual(result, "print('hello')")

    def test_parse_with_markdown(self):
        """测试解析带 Markdown 的内容"""
        content = """Here is the solution:

```python
result = "test"
```
"""
        result = parse_script(content)
        self.assertEqual(result.strip(), 'result = "test"')


class TestParseResults(unittest.TestCase):
    """测试 parse_results"""

    def test_parse_json_results(self):
        """测试解析 JSON 结果"""
        content = '{"status": "completed", "result": "test result"}'
        result = parse_results(content)

        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["result"], "test result")

    def test_parse_plain_text(self):
        """测试解析纯文本"""
        content = "This is a plain text result"
        result = parse_results(content)

        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["result"], content)

    def test_parse_json_in_text(self):
        """测试解析文本中的 JSON"""
        content = 'Some text {"status": "completed"} more text'
        result = parse_results(content)

        self.assertEqual(result["status"], "completed")


class TestWriteResults(unittest.TestCase):
    """测试写入结果"""

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.node_dir = os.path.join(self.temp_dir, "test_node")
        os.makedirs(self.node_dir)

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def test_write_completed(self):
        """测试写入完成状态（results.md 为控制台风格，用 parse_results_content 解析）"""
        write_results_completed(self.node_dir, "test result")

        results_path = os.path.join(self.node_dir, "results.md")
        self.assertTrue(os.path.exists(results_path))

        with open(results_path, "r", encoding="utf-8") as f:
            result = parse_results_content(f.read())

        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["result"], "test result")

    def test_write_completed_removes_old(self):
        """测试写入完成时删除旧文件"""
        old_path = os.path.join(self.node_dir, "results.md")
        with open(old_path, "w") as f:
            f.write("old content")

        write_results_completed(self.node_dir, "new result")

        with open(old_path, "r", encoding="utf-8") as f:
            result = parse_results_content(f.read())

        self.assertEqual(result["result"], "new result")

    def test_write_escalated(self):
        """测试写入升级状态"""
        write_results_escalated(self.node_dir, "reason for escalation")

        results_path = os.path.join(self.node_dir, "results.md")
        self.assertTrue(os.path.exists(results_path))

        with open(results_path, "r", encoding="utf-8") as f:
            result = parse_results_content(f.read())

        self.assertEqual(result["status"], "escalated")
        self.assertEqual(result["reason"], "reason for escalation")

    def test_write_escalated_with_error_ref(self):
        """测试写入升级状态带错误引用"""
        write_results_escalated(self.node_dir, "reason", "error.md")

        results_path = os.path.join(self.node_dir, "results.md")
        with open(results_path, "r", encoding="utf-8") as f:
            result = parse_results_content(f.read())

        self.assertEqual(result.get("error_ref"), "error.md")


class TestUpdateMetaStatus(unittest.TestCase):
    """测试更新 meta 状态"""

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.node_dir = os.path.join(self.temp_dir, "test_node")
        os.makedirs(self.node_dir)

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def test_update_to_completed(self):
        """测试更新为完成状态"""
        # 先创建 meta.json
        meta = {"status": "running", "completed_at": None}
        with open(os.path.join(self.node_dir, "meta.json"), "w") as f:
            json.dump(meta, f)

        update_meta_status(self.node_dir, "completed")

        with open(os.path.join(self.node_dir, "meta.json"), "r") as f:
            result = json.load(f)

        self.assertEqual(result["status"], "completed")
        self.assertIsNotNone(result["completed_at"])

    def test_update_to_failed(self):
        """测试更新为失败状态"""
        meta = {"status": "running"}
        with open(os.path.join(self.node_dir, "meta.json"), "w") as f:
            json.dump(meta, f)

        update_meta_status(self.node_dir, "failed")

        with open(os.path.join(self.node_dir, "meta.json"), "r") as f:
            result = json.load(f)

        self.assertEqual(result["status"], "failed")


class TestExecuteScript(unittest.TestCase):
    """测试 execute_script"""

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.node_dir = os.path.join(self.temp_dir, "test_node")
        os.makedirs(self.node_dir)

        self.mock_logger = Mock()
        self.mock_logger.log_trace = Mock(return_value=1)

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def test_script_not_found(self):
        """测试脚本不存在"""
        permissions = {"read": [], "write": ["./"]}

        with self.assertRaises(FileNotFoundError):
            execute_script(self.node_dir, permissions, self.mock_logger)

    def test_execute_simple_script(self):
        """测试执行简单脚本"""
        # 创建简单的 script.py
        script_path = os.path.join(self.node_dir, "script.py")
        with open(script_path, "w") as f:
            f.write("result = 'test'")

        # 创建 results.md
        results_path = os.path.join(self.node_dir, "results.md")
        with open(results_path, "w") as f:
            json.dump({"status": "completed", "result": "test"}, f)

        permissions = {"read": [], "write": ["./"]}

        # 这应该能执行
        execute_script(self.node_dir, permissions, self.mock_logger)


class TestSanitizeSubtaskName(unittest.TestCase):
    """测试 sanitize_subtask_name 函数"""

    def test_normal_name(self):
        """测试正常名称"""
        from executor import sanitize_subtask_name

        result = sanitize_subtask_name("subtask1")
        self.assertEqual(result, "subtask1")

    def test_name_with_spaces(self):
        """测试包含空格的名称"""
        from executor import sanitize_subtask_name

        result = sanitize_subtask_name("fetch papers")
        self.assertEqual(result, "fetch_papers")

    def test_name_with_special_chars(self):
        """测试包含特殊字符的名称"""
        from executor import sanitize_subtask_name

        result = sanitize_subtask_name("fetch/papers:2024")
        self.assertEqual(result, "fetchpapers2024")

    def test_name_with_unicode(self):
        """测试包含中文的名称"""
        from executor import sanitize_subtask_name

        result = sanitize_subtask_name("获取论文")
        # Unicode字符应该被保留
        self.assertEqual(result, "获取论文")

    def test_empty_name(self):
        """测试空名称"""
        from executor import sanitize_subtask_name

        result = sanitize_subtask_name("")
        self.assertTrue(result.startswith("subtask_"))

    def test_name_with_leading_trailing_spaces(self):
        """测试前后有空格的名称"""
        from executor import sanitize_subtask_name

        result = sanitize_subtask_name("  task1  ")
        self.assertEqual(result, "task1")

    def test_long_name(self):
        """测试超长名称"""
        from executor import sanitize_subtask_name

        long_name = "a" * 100
        result = sanitize_subtask_name(long_name)
        self.assertEqual(len(result), 64)

    def test_name_with_hyphen(self):
        """测试包含连字符的名称"""
        from executor import sanitize_subtask_name

        result = sanitize_subtask_name("fetch-papers-2024")
        self.assertEqual(result, "fetch-papers-2024")


if __name__ == "__main__":
    unittest.main()
