#!/usr/bin/env python3
"""
download_pdf.py - 下载 arXiv PDF 文件

用法:
    python download_pdf.py <arxiv_id> [output_path]

    python download_pdf.py 2501.12345
    python download_pdf.py 2501.12345 data/pdfs/2501.12345.pdf

依赖:
    pip install requests
"""

import argparse
import os
import sys
import time
from pathlib import Path
from typing import Optional
import urllib.request
import urllib.error


DEFAULT_USER_AGENT = (
    "SurveyAgent/1.0 (academic research; +https://github.com/survey-agent)"
)
MAX_RETRIES = 3
TIMEOUT = 30  # seconds


def download_pdf(
    arxiv_id: str,
    output_path: Optional[str] = None,
    timeout: int = TIMEOUT,
    max_retries: int = MAX_RETRIES,
) -> str:
    """
    下载 arXiv PDF 文件

    Args:
        arxiv_id: arXiv 论文 ID (如 2501.12345)
        output_path: 输出文件路径
        timeout: 超时时间
        max_retries: 最大重试次数

    Returns:
        下载文件的绝对路径
    """
    # 构建 PDF URL
    pdf_url = f"https://arxiv.org/pdf/{arxiv_id}.pdf"

    # 确定输出路径
    if output_path is None:
        # 默认保存到 data/pdfs 目录
        base_dir = Path(__file__).parent.parent / "data" / "pdfs"
        base_dir.mkdir(parents=True, exist_ok=True)
        output_path = str(base_dir / f"{arxiv_id}.pdf")

    output_path = os.path.abspath(output_path)
    output_dir = os.path.dirname(output_path)

    # 确保输出目录存在
    os.makedirs(output_dir, exist_ok=True)

    print(f"Downloading {arxiv_id} PDF from {pdf_url}", file=sys.stderr)
    print(f"Saving to {output_path}", file=sys.stderr)

    # 下载文件
    last_error = None
    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(
                pdf_url,
                headers={"User-Agent": DEFAULT_USER_AGENT, "Accept": "application/pdf"},
            )

            with urllib.request.urlopen(req, timeout=timeout) as response:
                total_size = int(response.headers.get("Content-Length", 0))
                downloaded = 0

                with open(output_path, "wb") as f:
                    chunk_size = 8192
                    while True:
                        chunk = response.read(chunk_size)
                        if not chunk:
                            break
                        f.write(chunk)
                        downloaded += len(chunk)

                        if total_size > 0:
                            progress = (downloaded / total_size) * 100
                            print(
                                f"\rProgress: {progress:.1f}%", file=sys.stderr, end=""
                            )

                print(f"\nDownloaded successfully: {output_path}", file=sys.stderr)
                return output_path

        except urllib.error.HTTPError as e:
            last_error = e
            print(
                f"HTTP Error {e.code}: {e.reason} (attempt {attempt + 1}/{max_retries})",
                file=sys.stderr,
            )
        except urllib.error.URLError as e:
            last_error = e
            print(
                f"URL Error: {e.reason} (attempt {attempt + 1}/{max_retries})",
                file=sys.stderr,
            )
        except Exception as e:
            last_error = e
            print(f"Error: {e} (attempt {attempt + 1}/{max_retries})", file=sys.stderr)

        # 等待后重试
        if attempt < max_retries - 1:
            wait_time = (attempt + 1) * 5
            print(f"Retrying in {wait_time}s...", file=sys.stderr)
            time.sleep(wait_time)

    # 所有重试都失败
    error_msg = f"Failed to download {arxiv_id} after {max_retries} attempts"
    if last_error:
        error_msg += f": {last_error}"
    raise RuntimeError(error_msg)


def main():
    parser = argparse.ArgumentParser(description="Download arXiv PDF")
    parser.add_argument("arxiv_id", type=str, help="arXiv paper ID (e.g., 2501.12345)")
    parser.add_argument(
        "output", nargs="?", type=str, help="Output file path (optional)"
    )
    parser.add_argument(
        "--timeout", "-t", type=int, default=TIMEOUT, help="Timeout in seconds"
    )

    args = parser.parse_args()

    try:
        output_path = download_pdf(args.arxiv_id, args.output, args.timeout)
        print(output_path)  # 输出路径供其他脚本使用
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
