"""
子进程入口：在独立进程中执行 goal_dir/script.py，便于隔离崩溃与完整捕获控制台输出。
由 executor.execute_script() 通过 subprocess 调用，不重定向 stdout/stderr，由父进程 capture_output 捕获。
"""
import os
import sys
import json

# 确保在 src 目录下可导入同目录模块
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

from logger import get_logger
from primitives import make_primitives


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: script_runner.py <goal_dir>", file=sys.stderr)
        sys.exit(2)

    goal_dir = os.path.abspath(sys.argv[1])
    script_path = os.path.join(goal_dir, "script.py")

    if not os.path.exists(script_path):
        print(f"Script not found: {script_path}", file=sys.stderr)
        sys.exit(1)

    # 从 executor 写入的临时文件读取 permissions
    perm_path = os.path.join(goal_dir, ".executor_permissions.json")
    permissions = {}
    if os.path.exists(perm_path):
        try:
            with open(perm_path, "r", encoding="utf-8") as f:
                permissions = json.load(f)
        except (json.JSONDecodeError, OSError):
            pass

    work_dir = os.path.dirname(goal_dir)
    logger = get_logger()
    if getattr(logger, "set_work_dir", None):
        logger.set_work_dir(work_dir)

    with open(script_path, "r", encoding="utf-8") as f:
        script_content = f.read()

    primitives = make_primitives(goal_dir, permissions, logger)
    exec_globals = {
        "__builtins__": __builtins__,
        "goal_dir": goal_dir,
        **primitives,
    }

    try:
        exec(script_content, exec_globals)
    except SystemExit as e:
        raise
    except Exception as e:
        # 将异常信息打印到 stderr，父进程会一并捕获
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
