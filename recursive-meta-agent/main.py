"""
Meta-Agent 入口
"""

import argparse
import os
import sys

# 添加 src 目录到路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

from agent import run_agent


def main():
    parser = argparse.ArgumentParser(description="Run meta-agent")
    parser.add_argument(
        "--goal-dir", type=str, required=True, help="Directory containing goal.md"
    )
    parser.add_argument(
        "--recover", action="store_true", help="Recover from previous failure"
    )

    args = parser.parse_args()

    # 检查目录
    goal_dir = os.path.abspath(args.goal_dir)

    if not os.path.exists(goal_dir):
        print(f"Error: Directory does not exist: {goal_dir}")
        sys.exit(1)

    goal_md = os.path.join(goal_dir, "goal.md")
    if not os.path.exists(goal_md):
        print(f"Error: goal.md not found in {goal_dir}")
        sys.exit(1)

    print(f"Starting meta-agent for: {goal_dir}")
    print(f"Mode: {'Recover' if args.recover else 'Normal'}")

    try:
        run_agent(goal_dir, recover_mode=args.recover)
        print("Meta-agent completed successfully!")
    except Exception as e:
        print(f"Error: {str(e)}")
        sys.exit(1)


if __name__ == "__main__":
    main()
