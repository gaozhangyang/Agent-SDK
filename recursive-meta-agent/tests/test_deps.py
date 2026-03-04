"""
测试依赖校验层
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from deps import (
    validate_dependencies,
    topological_sort,
    get_execution_levels,
    check_dependency_exists,
    get_task_dependencies,
    build_dependency_graph,
    find_independent_tasks,
    ValidationError,
)


class TestValidateDependencies(unittest.TestCase):
    """测试 validate_dependencies"""

    def test_valid_dependencies(self):
        """测试有效依赖"""
        subtasks = [
            {"name": "task1", "description": "desc1", "depends_on": []},
            {"name": "task2", "description": "desc2", "depends_on": ["task1"]},
            {"name": "task3", "description": "desc3", "depends_on": ["task1", "task2"]},
        ]

        result = validate_dependencies(subtasks)

        self.assertEqual(len(result), 3)
        # task1 应该在最前面
        self.assertEqual(result[0]["name"], "task1")

    def test_missing_dependency(self):
        """测试缺失依赖"""
        subtasks = [
            {"name": "task1", "description": "desc1", "depends_on": []},
            {"name": "task2", "description": "desc2", "depends_on": ["nonexistent"]},
        ]

        with self.assertRaises(ValidationError) as context:
            validate_dependencies(subtasks)

        self.assertEqual(context.exception.error_type, "missing_dependency")

    def test_circular_dependency(self):
        """测试循环依赖"""
        subtasks = [
            {"name": "task1", "description": "desc1", "depends_on": ["task2"]},
            {"name": "task2", "description": "desc2", "depends_on": ["task1"]},
        ]

        with self.assertRaises(ValidationError) as context:
            validate_dependencies(subtasks)

        self.assertEqual(context.exception.error_type, "circular_dependency")

    def test_self_dependency(self):
        """测试自我依赖"""
        subtasks = [{"name": "task1", "description": "desc1", "depends_on": ["task1"]}]

        with self.assertRaises(ValidationError):
            validate_dependencies(subtasks)

    def test_complex_circular(self):
        """测试复杂循环依赖"""
        subtasks = [
            {"name": "task1", "description": "desc1", "depends_on": ["task3"]},
            {"name": "task2", "description": "desc2", "depends_on": ["task1"]},
            {"name": "task3", "description": "desc3", "depends_on": ["task2"]},
        ]

        with self.assertRaises(ValidationError):
            validate_dependencies(subtasks)

    def test_empty_subtasks(self):
        """测试空子任务列表"""
        result = validate_dependencies([])
        self.assertEqual(result, [])


class TestTopologicalSort(unittest.TestCase):
    """测试拓扑排序"""

    def test_linear_order(self):
        """测试线性依赖"""
        tasks = [
            {"name": "a", "depends_on": []},
            {"name": "b", "depends_on": ["a"]},
            {"name": "c", "depends_on": ["b"]},
        ]

        result = topological_sort(tasks)

        self.assertIsNotNone(result)
        names = [t["name"] for t in result]
        self.assertEqual(names, ["a", "b", "c"])

    def test_parallel_branches(self):
        """测试并行分支"""
        tasks = [
            {"name": "a", "depends_on": []},
            {"name": "b", "depends_on": []},
            {"name": "c", "depends_on": ["a", "b"]},
        ]

        result = topological_sort(tasks)

        self.assertIsNotNone(result)
        names = [t["name"] for t in result]
        # c 应该在最后
        self.assertEqual(names[-1], "c")

    def test_no_dependencies(self):
        """测试无依赖"""
        tasks = [
            {"name": "a", "depends_on": []},
            {"name": "b", "depends_on": []},
            {"name": "c", "depends_on": []},
        ]

        result = topological_sort(tasks)

        self.assertIsNotNone(result)
        self.assertEqual(len(result), 3)

    def test_returns_none_on_cycle(self):
        """测试有环时返回 None"""
        tasks = [{"name": "a", "depends_on": ["b"]}, {"name": "b", "depends_on": ["a"]}]

        result = topological_sort(tasks)

        self.assertIsNone(result)


class TestGetExecutionLevels(unittest.TestCase):
    """测试获取执行层级"""

    def test_single_level(self):
        """测试单层（无依赖）"""
        tasks = [{"name": "a", "depends_on": []}, {"name": "b", "depends_on": []}]

        levels = get_execution_levels(tasks)

        self.assertEqual(len(levels), 1)
        self.assertEqual(len(levels[0]), 2)

    def test_multi_level(self):
        """测试多层"""
        tasks = [
            {"name": "a", "depends_on": []},
            {"name": "b", "depends_on": ["a"]},
            {"name": "c", "depends_on": ["b"]},
        ]

        levels = get_execution_levels(tasks)

        self.assertEqual(len(levels), 3)
        self.assertEqual(levels[0][0]["name"], "a")
        self.assertEqual(levels[1][0]["name"], "b")
        self.assertEqual(levels[2][0]["name"], "c")

    def test_parallel_level(self):
        """测试同层并行"""
        tasks = [
            {"name": "a", "depends_on": []},
            {"name": "b", "depends_on": []},
            {"name": "c", "depends_on": ["a", "b"]},
        ]

        levels = get_execution_levels(tasks)

        self.assertEqual(len(levels), 2)
        # 第一层应该有 a 和 b
        first_level_names = [t["name"] for t in levels[0]]
        self.assertIn("a", first_level_names)
        self.assertIn("b", first_level_names)
        # 第二层应该有 c
        self.assertEqual(levels[1][0]["name"], "c")


class TestDependencyHelpers(unittest.TestCase):
    """测试辅助函数"""

    def test_check_dependency_exists(self):
        """测试检查依赖是否存在"""
        subtasks = [
            {"name": "task1", "depends_on": []},
            {"name": "task2", "depends_on": []},
        ]

        self.assertTrue(check_dependency_exists("task1", subtasks))
        self.assertFalse(check_dependency_exists("task3", subtasks))

    def test_get_task_dependencies(self):
        """测试获取任务依赖"""
        subtasks = [
            {"name": "task1", "depends_on": []},
            {"name": "task2", "depends_on": ["task1"]},
        ]

        deps = get_task_dependencies("task2", subtasks)
        self.assertEqual(deps, ["task1"])

        deps = get_task_dependencies("task1", subtasks)
        self.assertEqual(deps, [])

    def test_build_dependency_graph(self):
        """测试构建依赖图"""
        tasks = [
            {"name": "a", "depends_on": []},
            {"name": "b", "depends_on": ["a"]},
            {"name": "c", "depends_on": ["a"]},
        ]

        graph = build_dependency_graph(tasks)

        self.assertIn("a", graph)
        self.assertIn("b", graph["a"])
        self.assertIn("c", graph["a"])

    def test_find_independent_tasks(self):
        """测试找出独立任务"""
        tasks = [
            {"name": "a", "depends_on": []},
            {"name": "b", "depends_on": ["a"]},
            {"name": "c", "depends_on": []},
        ]

        independent = find_independent_tasks(tasks)

        names = [t["name"] for t in independent]
        self.assertIn("a", names)
        self.assertIn("c", names)
        self.assertNotIn("b", names)


class TestValidationError(unittest.TestCase):
    """测试 ValidationError"""

    def test_error_types(self):
        """测试错误类型"""
        error = ValidationError("test", "missing_dependency", {"task": "a"})

        self.assertEqual(error.error_type, "missing_dependency")
        self.assertEqual(error.details["task"], "a")

    def test_circular_error(self):
        """测试循环依赖错误"""
        error = ValidationError(
            "circular", "circular_dependency", {"tasks": ["a", "b"]}
        )

        self.assertEqual(error.error_type, "circular_dependency")
        self.assertEqual(error.details["tasks"], ["a", "b"])


if __name__ == "__main__":
    unittest.main()
