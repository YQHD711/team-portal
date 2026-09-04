"""Chat endpoint — DeepSeek API proxy with SSE streaming.

性能 #6:复用 main.py 注入的 httpx.AsyncClient 单例(共享 TCP/TLS 连接池)
性能 #8:Semaphore 限流 DeepSeek 并发;lru_cache 缓存 API key(避免每请求同步读 SQLite)
"""

import asyncio
import json
import os
import sqlite3
from functools import lru_cache
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import httpx

router = APIRouter(prefix="/api/ai", tags=["chat"])

DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
TEAMPORTAL_DB_PATH = os.environ.get("TEAMPORTAL_DB_PATH", "../src/TeamPortal/Data/teamportal.db")
MAX_RETRIES = 2

# 性能 #8:单例 httpx + Semaphore(由 main.py lifespan 注入)
_http: httpx.AsyncClient | None = None
_sem: asyncio.Semaphore | None = None


def configure_chat_http(client: httpx.AsyncClient, sem: asyncio.Semaphore) -> None:
    global _http, _sem
    _http = client
    _sem = sem


@lru_cache(maxsize=1)
def get_api_key() -> str:
    """DeepSeek API key — env var 优先,DB 兜底。lru_cache 避免每请求同步阻塞事件循环读 SQLite。"""
    if DEEPSEEK_API_KEY:
        return DEEPSEEK_API_KEY
    try:
        with sqlite3.connect(f"file:{TEAMPORTAL_DB_PATH}?mode=ro", uri=True, timeout=5) as conn:
            row = conn.execute("SELECT Value FROM SystemSettings WHERE Key = 'AI:DeepSeekKey'").fetchone()
            return row[0] if row else ""
    except (sqlite3.Error, OSError):
        return ""


class ChatRequest(BaseModel):
    question: str


@router.post("/chat")
async def chat(req: ChatRequest):
    """Proxy chat requests to DeepSeek API, stream response via SSE."""
    api_key = get_api_key()
    if not api_key:
        async def error_stream():
            yield f"data: {json.dumps({'error': 'DeepSeek API key not configured.'})}\n\n"
        return StreamingResponse(error_stream(), media_type="text/event-stream")
    if _http is None or _sem is None:
        async def init_error():
            yield f"data: {json.dumps({'error': 'AI service not initialized'})}\n\n"
        return StreamingResponse(init_error(), media_type="text/event-stream")

    async def stream():
        for attempt in range(MAX_RETRIES + 1):
            try:
                async with _sem:  # 上游并发限流
                    async with _http.stream(
                        "POST",
                        f"{DEEPSEEK_BASE_URL}/v1/chat/completions",
                        headers={
                            "Authorization": f"Bearer {api_key}",
                            "Content-Type": "application/json",
                        },
                        json={
                            "model": "deepseek-chat",
                            "messages": [{"role": "user", "content": req.question}],
                            "stream": True,
                        },
                    ) as response:
                        if response.status_code != 200:
                            text = await response.aread()
                            error_msg = text.decode()
                            if response.status_code >= 500 and attempt < MAX_RETRIES:
                                await asyncio.sleep(2 ** attempt)
                                continue
                            # 性能 #L2:不再裸传上游错误体给客户端(可能含认证头)
                            yield f"data: {json.dumps({'error': 'Upstream AI service error'})}\n\n"
                            return

                        async for line in response.aiter_lines():
                            if line.startswith("data: "):
                                data = line[6:]
                                if data == "[DONE]":
                                    break
                                yield f"data: {data}\n\n"
                        return
            except (httpx.ConnectError, httpx.TimeoutException) as e:
                if attempt < MAX_RETRIES:
                    await asyncio.sleep(2 ** attempt)
                    continue
                yield f"data: {json.dumps({'error': f'Connection failed after retries'})}\n\n"
            except Exception:
                yield f"data: {json.dumps({'error': 'AI service error'})}\n\n"
                return

    return StreamingResponse(stream(), media_type="text/event-stream")