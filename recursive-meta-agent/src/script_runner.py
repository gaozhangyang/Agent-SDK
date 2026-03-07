"""
子进程入口：在独立进程中执行 goal_dir/script.py，便于隔离崩溃与完整捕获控制台输出。
由 executor.execute_script() 通过 subprocess 调用。
script.py 使用标准 Python（open、subprocess、os 等）；执行器仅注入 goal_dir，并将当前工作目录设为 goal_dir。
"""
import os
import sys

# 确保在 src 目录下可导入同目录模块
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: script_runner.py <goal_dir>", file=sys.stderr)
        sys.exit(2)

    goal_dir = os.path.abspath(sys.argv[1])
    script_path = os.path.join(goal_dir, "script.py")

    if not os.path.exists(script_path):
        print(f"Script not found: {script_path}", file=sys.stderr)
        sys.exit(1)

    with open(script_path, "r", encoding="utf-8") as f:
        script_content = f.read()

    # 仅注入 goal_dir；脚本内可使用标准库 open、subprocess、os 等
    exec_globals = {
        "__builtins__": __builtins__,
        "goal_dir": goal_dir,
    }
    # 当前工作目录设为节点目录，使脚本内相对路径相对于当前节点
    os.chdir(goal_dir)

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
