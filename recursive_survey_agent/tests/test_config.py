"""测试配置加载功能"""

import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# 添加项目根目录到路径
BASE_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(BASE_DIR))


class TestConfigLoading:
    """测试从 AGENT.md 加载配置"""

    def test_load_agent_config_basic(self):
        """测试基本配置加载"""
        from run import load_agent_config

        config = load_agent_config()

        # 验证基本配置存在
        assert "llm" in config
        assert "topics" in config
        assert "fetch_max_papers" in config

    def test_load_llm_config(self):
        """测试 LLM 配置"""
        from run import load_agent_config

        config = load_agent_config()
        llm_config = config.get("llm", {})

        assert "baseUrl" in llm_config
        assert "model" in llm_config
        # apiKey 可以是空字符串或从环境变量覆盖

    def test_load_topics_config(self):
        """测试 topics 配置"""
        from run import load_agent_config

        config = load_agent_config()
        topics = config.get("topics", [])

        assert len(topics) > 0

        # 验证每个 topic 有必要字段
        for topic in topics:
            assert "name" in topic
            assert "keywords" in topic
            assert "arxiv_categories" in topic
            assert "min_relevance_score" in topic

    def test_env_override(self, monkeypatch):
        """测试环境变量覆盖"""
        from run import load_agent_config

        # 设置环境变量
        monkeypatch.setenv("LLM_API_KEY", "test-key-123")
        monkeypatch.setenv("LLM_MODEL", "test-model")
        monkeypatch.setenv("LLM_BASE_URL", "http://test.example.com")

        config = load_agent_config()

        # 验证环境变量覆盖了配置
        assert config["llm"]["apiKey"] == "test-key-123"
        assert config["llm"]["model"] == "test-model"
        assert config["llm"]["baseUrl"] == "http://test.example.com"


class MockArgs:
    """模拟命令行参数"""

    def __init__(self, **kwargs):
        self.max_results = kwargs.get("max_results")
        self.start_date = kwargs.get("start_date")
        self.end_date = kwargs.get("end_date")
        self.research_query = kwargs.get("research_query")
        self.debug = kwargs.get("debug", False)
        self.recover = kwargs.get("recover", False)


class TestGoalBuilding:
    """测试目标构建"""

    def test_build_goal_basic(self):
        """测试基本目标构建"""
        from run import build_goal

        config = {
            "topics": [{"name": "Computer_Vision"}, {"name": "NLP_and_LLM"}],
            "fetch_max_papers": 10,
        }

        args = MockArgs()

        goal = build_goal(config, args)

        assert "Survey Workflow" in goal
        assert "Computer_Vision" in goal
        assert "NLP_and_LLM" in goal

    def test_build_goal_with_max_results(self):
        """测试带最大结果数的目标构建"""
        from run import build_goal

        config = {"topics": [{"name": "Computer_Vision"}], "fetch_max_papers": 10}

        args = MockArgs(max_results=20)
        goal = build_goal(config, args)

        assert "20" in goal
        assert "篇论文" in goal

    def test_build_goal_with_date_range(self):
        """测试带日期范围的目标构建"""
        from run import build_goal

        config = {"topics": [{"name": "Computer_Vision"}], "fetch_max_papers": 10}

        args = MockArgs(start_date="20260301", end_date="20260303")
        goal = build_goal(config, args)

        assert "20260301" in goal
        assert "20260303" in goal

    def test_build_goal_with_research_query(self):
        """测试带研究查询的目标构建"""
        from run import build_goal

        config = {"topics": [{"name": "Computer_Vision"}], "fetch_max_papers": 10}

        args = MockArgs(research_query="video generation")
        goal = build_goal(config, args)

        assert "video generation" in goal


class TestGoalDirectorySetup:
    """测试目标目录设置"""

    def test_setup_goal_directory(self, tmp_path):
        """测试目标目录创建"""
        # 创建一个临时项目目录
        project_dir = tmp_path / "test_project"
        project_dir.mkdir()

        # 创建必要的目录结构
        (project_dir / ".agent").mkdir()
        (project_dir / "skills").mkdir()
        (project_dir / "data").mkdir()
        (project_dir / "knowledge_base").mkdir()

        # 创建 AGENT.md
        agent_md = project_dir / ".agent" / "AGENT.md"
        agent_md.write_text("""
# Test Agent

## 运行时配置

```json
{
  "llm": {
    "baseUrl": "http://test.com",
    "model": "test-model",
    "apiKey": "test-key"
  },
  "topics": [
    {
      "name": "Test_Topic",
      "keywords": ["test"],
      "arxiv_categories": ["cs.CV"],
      "min_relevance_score": 0.6
    }
  ],
  "fetch_max_papers": 10,
  "max_depth": 4
}
```
""")

        # 导入并设置
        import run

        run.BASE_DIR = project_dir
        run.AGENT_MD = agent_md

        config = run.load_agent_config()

        # 临时替换 BASE_DIR
        original_base_dir = run.BASE_DIR
        run.BASE_DIR = project_dir

        try:
            args = MockArgs()
            goal = "Test goal for survey workflow"

            goal_dir = run.setup_goal_directory(goal, config, args)

            # 验证目录结构
            assert goal_dir.exists()
            assert (goal_dir / "goal.md").exists()
            assert (goal_dir / "permissions.json").exists()
            assert (goal_dir / "context.md").exists()

            # 验证 goal.md 内容
            goal_content = (goal_dir / "goal.md").read_text()
            assert goal == goal_content

            # 验证 permissions.json 格式
            permissions = json.loads((goal_dir / "permissions.json").read_text())
            assert "read" in permissions
            assert "write" in permissions
            assert "bash" in permissions
            assert "max_depth" in permissions

        finally:
            run.BASE_DIR = original_base_dir


class TestArgumentParsing:
    """测试命令行参数解析"""

    def test_parse_args_defaults(self):
        """测试默认参数"""
        from run import parse_args

        # 使用自定义 argv
        args = parse_args([])

        assert args.max_results is None
        assert args.start_date is None
        assert args.end_date is None
        assert args.research_query is None
        assert args.debug is False
        assert args.recover is False

    def test_parse_args_with_max_results(self):
        """测试 max-results 参数"""
        from run import parse_args

        args = parse_args(["--max-results", "20"])

        assert args.max_results == 20

    def test_parse_args_with_date_range(self):
        """测试日期范围参数"""
        from run import parse_args

        args = parse_args(["--start-date", "20260301", "--end-date", "20260303"])

        assert args.start_date == "20260301"
        assert args.end_date == "20260303"

    def test_parse_args_with_research_query(self):
        """测试研究查询参数"""
        from run import parse_args

        args = parse_args(["--research-query", "video generation"])

        assert args.research_query == "video generation"

    def test_parse_args_with_debug(self):
        """测试调试参数"""
        from run import parse_args

        args = parse_args(["--debug"])

        assert args.debug is True

    def test_parse_args_with_recover(self):
        """测试恢复参数"""
        from run import parse_args

        args = parse_args(["--recover"])

        assert args.recover is True


class TestContextContent:
    """测试上下文内容构建"""

    def test_build_context_content_basic(self):
        """测试基本上下文内容"""
        from run import build_context_content

        config = {
            "topics": [
                {
                    "name": "Computer_Vision",
                    "keywords": ["video generation"],
                    "arxiv_categories": ["cs.CV"],
                    "min_relevance_score": 0.6,
                }
            ],
            "fetch_max_papers": 10,
            "pdf_download_dir": "data/pdfs",
            "screening_threshold": 0.6,
            "max_depth": 4,
            "maxOutputLength": 102400,
            "context_budget_total": 200000,
            "context_budget_reserved": 4000,
        }

        args = MockArgs()
        context = build_context_content(config, args)

        assert "Survey Workflow Context" in context
        assert "Topics" in context
        assert "Computer_Vision" in context
        assert "Fetch 参数" in context
        assert "10" in context  # fetch_max_papers

    def test_build_context_content_with_overrides(self):
        """测试带覆盖参数的上下文内容"""
        from run import build_context_content

        config = {
            "topics": [{"name": "Test"}],
            "fetch_max_papers": 10,
        }

        args = MockArgs(max_results=50)
        context = build_context_content(config, args)

        assert "命令行覆盖参数" in context
        assert "50" in context


class TestRecursiveMetaAgentIntegration:
    """测试 recursive-meta-agent 集成"""

    def test_recursive_meta_agent_not_found(self):
        """测试 recursive-meta-agent 不存在时的错误处理"""
        import run

        # 临时修改路径指向不存在的目录
        original_dir = run.RECURSIVE_META_AGENT_DIR
        run.RECURSIVE_META_AGENT_DIR = Path("/nonexistent/path")

        try:
            result = run.run_recursive_meta_agent(Path("/tmp/test"))
            assert result["status"] == "error"
            assert "not found" in result["reason"].lower()
        finally:
            run.RECURSIVE_META_AGENT_DIR = original_dir


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
