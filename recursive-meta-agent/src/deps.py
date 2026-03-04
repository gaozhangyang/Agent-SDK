"""
依赖校验层
确定性校验：依赖存在性检查 + 循环依赖检测
"""

import json
from typing import List, Dict, Any, Set, Tuple, Optional
from collections import defaultdict, deque


class ValidationError(Exception):
    """依赖校验错误"""

    def __init__(self, message: str, error_type: str, details: dict = None):
        super().__init__(message)
        self.error_type = error_type
        self.details = details or {}


def validate_dependencies(subtasks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    确定性校验，两关：
    第一关：depends_on 里的每个依赖必须存在于当前子任务列表
    第二关：拓扑排序检测循环依赖
    校验失败：抛出 ValidationError，携带详细原因
    """

    # 第一关：检查依赖是否存在
    task_names = {task["name"] for task in subtasks}
    missing_deps = []

    for task in subtasks:
        depends_on = task.get("depends_on", [])
        for dep in depends_on:
            if dep not in task_names:
                missing_deps.append({"task": task["name"], "missing_dependency": dep})

    if missing_deps:
        raise ValidationError(
            message="Missing dependencies detected",
            error_type="missing_dependency",
            details={"missing": missing_deps},
        )

    # 第二关：检测循环依赖（拓扑排序）
    sorted_tasks = topological_sort(subtasks)

    if sorted_tasks is None:
        raise ValidationError(
            message="Circular dependency detected",
            error_type="circular_dependency",
            details={"tasks": [t["name"] for t in subtasks]},
        )

    return sorted_tasks


def topological_sort(tasks: List[Dict[str, Any]]) -> Optional[List[Dict[str, Any]]]:
    """
    拓扑排序，返回排序后的任务列表
    如果存在循环，返回 None
    """
    # 构建依赖图
    in_degree = defaultdict(int)
    graph = defaultdict(list)
    task_map = {task["name"]: task for task in tasks}

    for task in tasks:
        name = task["name"]
        if name not in in_degree:
            in_degree[name] = 0

        for dep in task.get("depends_on", []):
            graph[dep].append(name)
            in_degree[name] += 1

    # BFS
    queue = deque()
    for name, degree in in_degree.items():
        if degree == 0:
            queue.append(name)

    sorted_names = []

    while queue:
        name = queue.popleft()
        sorted_names.append(name)

        for neighbor in graph[name]:
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)

    # 如果排序的任务数不等于总任务数，说明有循环
    if len(sorted_names) != len(tasks):
        return None

    # 按排序顺序返回任务
    return [task_map[name] for name in sorted_names]


def get_execution_levels(tasks: List[Dict[str, Any]]) -> List[List[Dict[str, Any]]]:
    """
    获取执行层级，按拓扑序返回
    返回: [[task1, task2], [task3], [task4, task5], ...]
    """
    # 拓扑排序
    sorted_tasks = topological_sort(tasks)
    if sorted_tasks is None:
        raise ValidationError(
            message="Circular dependency detected",
            error_type="circular_dependency",
            details={},
        )

    # 构建依赖图
    task_deps = {task["name"]: set(task.get("depends_on", [])) for task in sorted_tasks}

    levels = []
    remaining = set(task_deps.keys())
    completed = set()

    while remaining:
        # 找出所有依赖都已完成的任务
        current_level = []
        for task_name in remaining:
            deps = task_deps[task_name]
            if deps.issubset(completed):
                current_level.append(task_name)

        if not current_level:
            # 不应该发生，因为前面已经验证无循环
            raise ValidationError(
                message="Unable to determine execution level",
                error_type="dependency_error",
                details={},
            )

        # 添加当前层
        level_tasks = [task for task in sorted_tasks if task["name"] in current_level]
        levels.append(level_tasks)

        # 更新已完成集合
        completed.update(current_level)
        remaining -= set(current_level)

    return levels


def check_dependency_exists(task_name: str, subtasks: List[Dict[str, Any]]) -> bool:
    """检查任务名是否存在于子任务列表中"""
    return any(task["name"] == task_name for task in subtasks)


def get_task_dependencies(task_name: str, subtasks: List[Dict[str, Any]]) -> List[str]:
    """获取任务的依赖列表"""
    for task in subtasks:
        if task["name"] == task_name:
            return task.get("depends_on", [])
    return []


def build_dependency_graph(subtasks: List[Dict[str, Any]]) -> Dict[str, List[str]]:
    """构建依赖图"""
    graph = defaultdict(list)
    for task in subtasks:
        name = task["name"]
        for dep in task.get("depends_on", []):
            graph[dep].append(name)
    return dict(graph)


def find_independent_tasks(subtasks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """找出所有没有依赖的任务"""
    return [task for task in subtasks if not task.get("depends_on", [])]
