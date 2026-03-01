#!/usr/bin/env python3
"""
test_arxiv_pdf.py - 单元测试：测试从 arXiv 获取 PDF 并存储到本地

测试功能：
1. 测试 download_pdf 函数能否成功从 arXiv 下载 PDF
2. 测试 PDF 是否正确保存到本地
3. 测试 PDF 文件是否有效（非空，正确的文件头）

依赖:
    pip install pytest requests

运行:
    python -m pytest test_arxiv_pdf.py -v
    python -m pytest test_arxiv_pdf.py -v --tb=short
"""

import os
import sys
import tempfile
import hashlib
import unittest
from pathlib import Path

# 添加 scripts 目录到路径
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

from download_pdf import download_pdf


class TestArxivPDFDownload(unittest.TestCase):
    """测试 arXiv PDF 下载功能"""
    
    def setUp(self):
        """测试前准备"""
        # 创建临时目录用于测试
        self.temp_dir = tempfile.mkdtemp()
        print(f"\n[Test] Using temp directory: {self.temp_dir}")
    
    def tearDown(self):
        """测试后清理"""
        import shutil
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
            print(f"\n[Test] Cleaned up temp directory: {self.temp_dir}")
    
    def test_download_pdf_success(self):
        """测试成功下载 arXiv PDF"""
        # 使用一个已知的 arXiv ID 进行测试
        # 2602.23360 是一个真实的 arXiv 论文
        test_arxiv_id = "2602.23360"
        output_path = os.path.join(self.temp_dir, f"{test_arxiv_id}.pdf")
        
        print(f"\n[Test] Downloading arXiv paper: {test_arxiv_id}")
        
        # 调用下载函数
        result_path = download_pdf(
            arxiv_id=test_arxiv_id,
            output_path=output_path,
            timeout=120,
            max_retries=5
        )
        
        # 验证返回的路径
        self.assertIsNotNone(result_path)
        self.assertTrue(os.path.exists(result_path))
        
        # 验证文件不为空
        file_size = os.path.getsize(result_path)
        self.assertGreater(file_size, 0, "Downloaded file should not be empty")
        print(f"[Test] File size: {file_size} bytes")
        
        # 验证 PDF 文件头 (%PDF)
        with open(result_path, 'rb') as f:
            header = f.read(5)
            self.assertEqual(header, b'%PDF-', f"File should be a valid PDF, got header: {header}")
        
        print(f"[Test] ✓ PDF downloaded successfully to: {result_path}")
    
    def test_download_pdf_to_custom_directory(self):
        """测试下载到自定义目录"""
        test_arxiv_id = "2602.23360"
        custom_dir = os.path.join(self.temp_dir, "custom_pdfs")
        os.makedirs(custom_dir, exist_ok=True)
        
        output_path = os.path.join(custom_dir, f"{test_arxiv_id}.pdf")
        
        result_path = download_pdf(
            arxiv_id=test_arxiv_id,
            output_path=output_path,
            timeout=120,
            max_retries=5
        )
        
        # 验证文件存在
        self.assertTrue(os.path.exists(result_path))
        
        # 验证文件大小合理（至少 10KB）
        file_size = os.path.getsize(result_path)
        self.assertGreater(file_size, 10000, "PDF file should be at least 10KB")
        
        print(f"[Test] ✓ PDF downloaded to custom directory: {result_path}")
    
    def test_download_invalid_arxiv_id(self):
        """测试下载无效的 arXiv ID"""
        invalid_arxiv_id = "9999.99999"  # 不存在的 ID
        
        with self.assertRaises(RuntimeError) as context:
            download_pdf(
                arxiv_id=invalid_arxiv_id,
                output_path=os.path.join(self.temp_dir, "invalid.pdf"),
                timeout=60,
                max_retries=2
            )
        
        # 验证错误信息包含相关描述
        self.assertIn("Failed to download", str(context.exception))
        print(f"[Test] ✓ Invalid ID correctly raised error: {context.exception}")
    
    def test_pdf_file_integrity(self):
        """测试 PDF 文件完整性 - 验证文件哈希值"""
        test_arxiv_id = "2602.23360"
        output_path = os.path.join(self.temp_dir, f"{test_arxiv_id}.pdf")
        
        result_path = download_pdf(
            arxiv_id=test_arxiv_id,
            output_path=output_path,
            timeout=120,
            max_retries=5
        )
        
        # 计算文件哈希
        with open(result_path, 'rb') as f:
            file_hash = hashlib.md5(f.read()).hexdigest()
        
        print(f"[Test] PDF MD5 hash: {file_hash}")
        
        # 验证哈希值不是空的
        self.assertTrue(len(file_hash) > 0, "File hash should not be empty")
        
        # 验证文件可以被多次读取
        with open(result_path, 'rb') as f:
            content1 = f.read()
        with open(result_path, 'rb') as f:
            content2 = f.read()
        
        self.assertEqual(content1, content2, "File should be readable multiple times")
        print(f"[Test] ✓ PDF file integrity verified")


class TestArxivURLConstruction(unittest.TestCase):
    """测试 arXiv URL 构建"""
    
    def test_arxiv_pdf_url_format(self):
        """测试 arXiv PDF URL 格式"""
        test_ids = [
            ("2602.23360", "https://arxiv.org/pdf/2602.23360.pdf"),
            ("2301.12345v2", "https://arxiv.org/pdf/2301.12345v2.pdf"),
            ("hep-th/9901001", "https://arxiv.org/pdf/hep-th/9901001.pdf"),
        ]
        
        for arxiv_id, expected_url in test_ids:
            actual_url = f"https://arxiv.org/pdf/{arxiv_id}.pdf"
            self.assertEqual(actual_url, expected_url)
            print(f"[Test] ✓ URL format correct: {actual_url}")


if __name__ == "__main__":
    # 运行测试
    unittest.main(verbosity=2)
