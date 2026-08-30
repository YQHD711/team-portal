"""Security tests for AI service routes.

验证:
- C1: parse.py 拒绝客户端 filepath(改 multipart UploadFile)
- C2: documents.py 拒绝客户端 filepath(改 multipart UploadFile)
- C3: logs.py 拒绝路径遍历 ../  / 起首 . / 反斜杠
"""
import io
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


# ── C1: parse.py 不再接受 filepath query/body ────────────────────

class TestParseExcelSecurity:
    def test_post_excel_with_filepath_param_is_rejected(self):
        """POST /api/parse/excel 不接受 filepath 参数(必须 multipart UploadFile)"""
        resp = client.post("/api/parse/excel", json={"filepath": "/etc/passwd"})
        # FastAPI 不识别 multipart 字段时会返回 422,且不会触发任意文件读
        assert resp.status_code in (400, 422)

    def test_get_excel_info_endpoint_disabled(self):
        """GET /api/parse/excel/info 已禁用(原接受 filepath 任意文件读)"""
        resp = client.get("/api/parse/excel/info", params={"filepath": "/etc/passwd"})
        assert resp.status_code == 410


# ── C2: documents.py 拒绝 filepath ─────────────────────────────────

class TestDocumentsSecurity:
    def test_post_extract_with_filepath_is_rejected(self):
        """POST /api/documents/extract 不再接受 filepath"""
        resp = client.post("/api/documents/extract", json={"filepath": "/etc/passwd"})
        assert resp.status_code in (400, 422)

    def test_post_extract_with_invalid_ext_rejected(self):
        """上传非允许扩展名直接 400"""
        # 创建一个 .exe 文件(伪造名)上传
        files = {"file": ("evil.exe", io.BytesIO(b"MZ\x90\x00"), "application/octet-stream")}
        resp = client.post("/api/documents/extract", files=files)
        assert resp.status_code == 400

    def test_post_extract_md_upload_works(self):
        """允许的扩展名 (.md/.txt) 上传可工作"""
        files = {"file": ("note.md", io.BytesIO(b"# Hello\n\ncontent"), "text/markdown")}
        resp = client.post("/api/documents/extract", files=files)
        assert resp.status_code == 200
        data = resp.json()
        assert "text" in data
        assert "Hello" in data["text"]


# ── C3: logs.py 路径遍历拦截 ─────────────────────────────────────

class TestLogsPathTraversal:
    def test_parse_log_rejects_parent_traversal(self):
        """/api/logs/parse filename 含 ../ 必须被拒绝(400 含 / 或 404 越界)"""
        resp = client.post("/api/logs/parse", json={"filename": "../../../etc/passwd"})
        assert resp.status_code in (400, 404)

    def test_parse_log_rejects_absolute_path(self):
        """/api/logs/parse 接受 ..\\ 反斜杠(Windows 风格) 必须 400"""
        resp = client.post("/api/logs/parse", json={"filename": "..\\..\\windows\\system32\\config\\sam"})
        assert resp.status_code in (400, 404)

    def test_parse_log_rejects_slash_in_filename(self):
        """/api/logs/parse 接受含 / 必须 400"""
        resp = client.post("/api/logs/parse", json={"filename": "subdir/file.tlog"})
        assert resp.status_code == 400

    def test_parse_log_rejects_dotfile(self):
        """/api/logs/parse 接受以 . 开头必须 400"""
        resp = client.post("/api/logs/parse", json={"filename": ".env"})
        assert resp.status_code == 400

    def test_parse_log_empty_filename_rejected(self):
        """空 filename 必须 400"""
        resp = client.post("/api/logs/parse", json={"filename": ""})
        assert resp.status_code in (400, 422)

    def test_parse_log_nonexistent_returns_404(self):
        """合法文件名但文件不存在 必须 404"""
        resp = client.post("/api/logs/parse", json={"filename": "nonexistent.tlog"})
        assert resp.status_code == 404

    def test_parse_log_filename_too_long_rejected(self):
        """> 255 字符必须被 Pydantic Field 拒绝"""
        resp = client.post("/api/logs/parse", json={"filename": "x" * 300})
        assert resp.status_code == 422