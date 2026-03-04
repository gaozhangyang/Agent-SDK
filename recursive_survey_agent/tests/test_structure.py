"""测试项目结构和文件完整性"""

import os
import sys
from pathlib import Path

import pytest

BASE_DIR = Path(__file__).parent.parent


class TestProjectStructure:
    """测试项目结构"""

    def test_required_directories_exist(self):
        """测试必需的目录存在"""
        required_dirs = [
            ".agent",
            "skills/arxiv_api",
            "skills/screening",
            "skills/writing",
            "skills/pdf_extract",
            "data/pdfs",
            "knowledge_base",
            "templates",
        ]

        for dir_path in required_dirs:
            full_path = BASE_DIR / dir_path
            assert full_path.exists(), f"Directory {dir_path} does not exist"
            assert full_path.is_dir(), f"{dir_path} is not a directory"

    def test_goals_directory_creatable(self):
        """测试 goals 目录可以被创建"""
        # goals 目录应该在运行时由 run.py 创建
        # 这里只检查父目录可写
        goals_parent = BASE_DIR
        assert os.access(goals_parent, os.W_OK), "Cannot write to parent directory"

    def test_required_files_exist(self):
        """测试必需的文件存在"""
        required_files = [
            ".agent/AGENT.md",
            "run.py",
            "skills/arxiv_api/SKILL.md",
            "skills/arxiv_api/fetch_arxiv.py",
            "skills/screening/SKILL.md",
            "skills/screening/screen_papers.py",
            "skills/writing/SKILL.md",
            "skills/pdf_extract/SKILL.md",
            "skills/pdf_extract/download_pdf.py",
            "skills/pdf_extract/extract_text.py",
            "templates/paper_summary.md",
        ]

        for file_path in required_files:
            full_path = BASE_DIR / file_path
            assert full_path.exists(), f"File {file_path} does not exist"
            assert full_path.is_file(), f"{file_path} is not a file"

    def test_knowledge_base_structure(self):
        """测试知识库结构"""
        kb_dir = BASE_DIR / "knowledge_base"

        # 应该有至少一个 topic
        topics = [d for d in kb_dir.iterdir() if d.is_dir()]
        assert len(topics) > 0, "No topics found in knowledge_base"

        # 每个 topic 应该有 meta.json
        for topic in topics:
            meta_file = topic / "meta.json"
            assert meta_file.exists(), f"meta.json not found in {topic.name}"

    def test_agent_md_has_runtime_config(self):
        """测试 AGENT.md 包含运行时配置"""
        agent_md = BASE_DIR / ".agent" / "AGENT.md"
        content = agent_md.read_text()

        assert "运行时配置" in content
        assert "```json" in content
        assert '"topics"' in content
        assert '"llm"' in content

    def test_skills_have_documentation(self):
        """测试每个 skill 都有 SKILL.md"""
        skills_dir = BASE_DIR / "skills"

        for skill_path in skills_dir.iterdir():
            if skill_path.is_dir():
                skill_md = skill_path / "SKILL.md"
                assert skill_md.exists(), f"SKILL.md not found for {skill_path.name}"


class TestSkillsContent:
    """测试 skills 内容"""

    def test_arxiv_api_skill(self):
        """测试 arxiv_api skill"""
        skill_md = BASE_DIR / "skills/arxiv_api/SKILL.md"
        content = skill_md.read_text()

        assert "arXiv" in content
        assert "fetch" in content.lower()

    def test_screening_skill(self):
        """测试 screening skill"""
        skill_md = BASE_DIR / "skills/screening/SKILL.md"
        content = skill_md.read_text()

        assert "screening" in content.lower() or "filter" in content.lower()

    def test_writing_skill(self):
        """测试 writing skill"""
        skill_md = BASE_DIR / "skills/writing/SKILL.md"
        content = skill_md.read_text()

        assert "writing" in content.lower() or "summary" in content.lower()

    def test_pdf_extract_skill(self):
        """测试 pdf_extract skill"""
        skill_md = BASE_DIR / "skills/pdf_extract/SKILL.md"
        content = skill_md.read_text()

        assert "PDF" in content or "pdf" in content.lower()


class TestEntryPoint:
    """测试入口点"""

    def test_run_py_is_executable(self):
        """测试 run.py 可执行"""
        run_py = BASE_DIR / "run.py"

        # 应该是有效的 Python 文件
        content = run_py.read_text()
        assert 'if __name__ == "__main__"' in content
        assert "def main()" in content


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
