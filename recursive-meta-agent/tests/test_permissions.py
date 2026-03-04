"""
测试 permissions 模块
"""

import os
import sys
import tempfile
import shutil
import json
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from permissions import (
    DEFAULT_PERMISSIONS,
    load_permissions,
    inherit_permissions,
    validate_permission,
    check_read_permission,
    check_write_permission,
    save_permissions,
)


class TestDefaultPermissions(unittest.TestCase):
    """测试默认权限"""

    def test_default_permissions_structure(self):
        """测试默认权限结构"""
        self.assertIn("read", DEFAULT_PERMISSIONS)
        self.assertIn("write", DEFAULT_PERMISSIONS)
        self.assertIn("bash", DEFAULT_PERMISSIONS)
        self.assertIn("max_depth", DEFAULT_PERMISSIONS)
        self.assertIn("max_output_length", DEFAULT_PERMISSIONS)
        self.assertIn("context_budget", DEFAULT_PERMISSIONS)

    def test_default_permissions_values(self):
        """测试默认权限值"""
        self.assertEqual(DEFAULT_PERMISSIONS["max_depth"], 4)
        self.assertEqual(DEFAULT_PERMISSIONS["max_output_length"], 102400)
        self.assertEqual(DEFAULT_PERMISSIONS["context_budget"]["total"], 200000)


class TestLoadPermissions(unittest.TestCase):
    """测试 load_permissions"""

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.node_dir = os.path.join(self.temp_dir, "test_node")
        os.makedirs(self.node_dir)

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def test_load_permissions_default(self):
        """测试加载默认权限"""
        permissions = load_permissions(self.node_dir)

        self.assertEqual(permissions["max_depth"], 4)
        self.assertIn("read", permissions)

    def test_load_permissions_existing(self):
        """测试加载已存在的权限配置"""
        permissions_data = {"max_depth": 2, "read": ["../"], "write": ["./"]}
        perm_path = os.path.join(self.node_dir, "permissions.json")
        with open(perm_path, "w") as f:
            json.dump(permissions_data, f)

        permissions = load_permissions(self.node_dir)

        self.assertEqual(permissions["max_depth"], 2)

    def test_load_permissions_inherit(self):
        """测试权限继承"""
        # 创建父目录权限
        parent_dir = os.path.join(self.temp_dir, "parent")
        os.makedirs(parent_dir)
        parent_perms = {"max_depth": 3, "read": ["./"]}
        with open(os.path.join(parent_dir, "permissions.json"), "w") as f:
            json.dump(parent_perms, f)

        # 创建子目录
        child_dir = os.path.join(parent_dir, "child")
        os.makedirs(child_dir)

        child_perms = load_permissions(child_dir)

        # 子节点不能超过父节点
        self.assertLessEqual(child_perms["max_depth"], 3)


class TestInheritPermissions(unittest.TestCase):
    """测试权限继承"""

    def test_inherit_max_depth(self):
        """测试深度继承"""
        parent = {"max_depth": 5}
        child = {"max_depth": 3}

        result = inherit_permissions(parent, child)

        self.assertEqual(result["max_depth"], 3)

    def test_inherit_max_depth_child_exceeds(self):
        """测试子节点超过父节点深度"""
        parent = {"max_depth": 3}
        child = {"max_depth": 5}

        result = inherit_permissions(parent, child)

        self.assertEqual(result["max_depth"], 3)

    def test_inherit_read(self):
        """测试读取权限继承"""
        parent = {"read": ["../", "./"]}
        child = {"read": ["../"]}

        result = inherit_permissions(parent, child)

        self.assertIn("../", result["read"])

    def test_inherit_write(self):
        """测试写入权限继承"""
        parent = {"write": ["./", "../"]}
        child = {"write": ["./"]}

        result = inherit_permissions(parent, child)

        self.assertIn("./", result["write"])


class TestValidatePermission(unittest.TestCase):
    """测试权限校验"""

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.node_dir = os.path.join(self.temp_dir, "test_node")
        os.makedirs(self.node_dir)

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def test_validate_read_allowed(self):
        """测试允许读取"""
        permissions = {"read": ["./"]}

        result = validate_permission("read", self.node_dir, permissions, self.node_dir)

        self.assertTrue(result)

    def test_validate_read_denied(self):
        """测试拒绝读取"""
        permissions = {"read": []}

        result = validate_permission("read", "/tmp/test", permissions, self.node_dir)

        self.assertFalse(result)

    def test_validate_write_allowed(self):
        """测试允许写入"""
        permissions = {"write": ["./"]}

        result = validate_permission("write", self.node_dir, permissions, self.node_dir)

        self.assertTrue(result)

    def test_validate_write_denied(self):
        """测试拒绝写入"""
        permissions = {"write": []}

        result = validate_permission("write", "/tmp/test", permissions, self.node_dir)

        self.assertFalse(result)

    def test_validate_bash(self):
        """测试 bash 权限"""
        permissions = {"bash": {"network": True}}

        result = validate_permission("bash", "", permissions, self.node_dir)

        self.assertTrue(result)


class TestCheckPermissions(unittest.TestCase):
    """测试便捷权限检查函数"""

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.node_dir = os.path.join(self.temp_dir, "test_node")
        os.makedirs(self.node_dir)

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def test_check_read_permission(self):
        """测试 check_read_permission"""
        permissions = {"read": ["./"]}

        result = check_read_permission(self.node_dir, permissions, self.node_dir)

        self.assertTrue(result)

    def test_check_write_permission(self):
        """测试 check_write_permission"""
        permissions = {"write": ["./"]}

        result = check_write_permission(self.node_dir, permissions, self.node_dir)

        self.assertTrue(result)


class TestSavePermissions(unittest.TestCase):
    """测试保存权限"""

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.node_dir = os.path.join(self.temp_dir, "test_node")
        os.makedirs(self.node_dir)

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def test_save_permissions(self):
        """测试保存权限"""
        permissions = {"max_depth": 2, "read": ["./"]}

        save_permissions(self.node_dir, permissions)

        perm_path = os.path.join(self.node_dir, "permissions.json")
        self.assertTrue(os.path.exists(perm_path))

        with open(perm_path, "r") as f:
            loaded = json.load(f)

        self.assertEqual(loaded["max_depth"], 2)


if __name__ == "__main__":
    unittest.main()
