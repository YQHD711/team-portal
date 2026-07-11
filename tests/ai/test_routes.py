"""Tests for AI service routes — chat, search, health."""

import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, AsyncMock
import sys
import os

# Add ai-service to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "ai-service"))

from main import app

client = TestClient(app)


class TestHealthRoutes:
    def test_root_returns_ok(self):
        resp = client.get("/")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert "AI Service" in data["service"]

    def test_health_returns_healthy(self):
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "healthy"


class TestSearchRoute:
    def test_search_without_api_key_returns_sources(self):
        """Search should return sources even without DeepSeek API key."""
        resp = client.post("/api/ai/search", json={"query": "test"})
        assert resp.status_code == 200
        data = resp.json()
        assert "sources" in data
        assert "answer" in data

    @patch("routes.search.DEEPSEEK_API_KEY", "fake-key")
    @patch("httpx.AsyncClient.post")
    def test_search_with_api_key_calls_deepseek(self, mock_post):
        """Search with API key should call DeepSeek and return answer."""
        mock_post.return_value.raise_for_status = lambda: None
        mock_post.return_value.json = lambda: {
            "choices": [{"message": {"content": "Test answer"}}]
        }
        mock_post.return_value.__aenter__ = AsyncMock(return_value=mock_post.return_value)
        mock_post.return_value.__aexit__ = AsyncMock()

        resp = client.post("/api/ai/search", json={"query": "飞行"})
        assert resp.status_code == 200
        data = resp.json()
        assert "sources" in data


class TestChatRoute:
    def test_chat_streams_sse(self):
        """Chat endpoint should return SSE stream content type."""
        resp = client.post("/api/ai/chat", json={"question": "hello"})
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers["content-type"]

    @patch("routes.chat.DEEPSEEK_API_KEY", "")
    def test_chat_without_key_returns_error(self):
        """Chat without API key should stream error message."""
        # Use stream to read the SSE response
        with client.stream("POST", "/api/ai/chat", json={"question": "test"}) as resp:
            assert resp.status_code == 200
            content = b""
            for chunk in resp.iter_bytes():
                content += chunk
            assert b"not configured" in content
