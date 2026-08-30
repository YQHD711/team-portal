"""Chat endpoint — DeepSeek API proxy with SSE streaming."""

import asyncio
import json
import os
import sqlite3
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import httpx

router = APIRouter(prefix="/api/ai", tags=["chat"])

DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
# Backend SQLite DB — fallback source for the AI:DeepSeekKey system setting
TEAMPORTAL_DB_PATH = os.environ.get("TEAMPORTAL_DB_PATH", "../src/TeamPortal/Data/teamportal.db")
MAX_RETRIES = 2


def _read_db_key() -> str:
    """Read AI:DeepSeekKey from the backend's SystemSettings table (read-only)."""
    try:
        with sqlite3.connect(f"file:{TEAMPORTAL_DB_PATH}?mode=ro", uri=True, timeout=5) as conn:
            row = conn.execute("SELECT Value FROM SystemSettings WHERE Key = 'AI:DeepSeekKey'").fetchone()
            return row[0] if row else ""
    except (sqlite3.Error, OSError):
        return ""


def get_api_key() -> str:
    """DeepSeek API key — env var first, then the system settings DB."""
    if DEEPSEEK_API_KEY:
        return DEEPSEEK_API_KEY
    return _read_db_key()


class ChatRequest(BaseModel):
    question: str


@router.post("/chat")
async def chat(req: ChatRequest):
    """Proxy chat requests to DeepSeek API, stream response via SSE."""
    async def stream():
        api_key = get_api_key()
        if not api_key:
            yield f"data: {json.dumps({'error': 'DeepSeek API key not configured. Set the DEEPSEEK_API_KEY environment variable or save AI:DeepSeekKey in the system settings page.'})}\n\n"
            return

        for attempt in range(MAX_RETRIES + 1):
            try:
                async with httpx.AsyncClient(timeout=60.0) as client:
                    async with client.stream(
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
                            # Retry on server errors
                            if response.status_code >= 500 and attempt < MAX_RETRIES:
                                await asyncio.sleep(2 ** attempt)
                                continue
                            yield f"data: {json.dumps({'error': f'DeepSeek API error: {error_msg}'})}\n\n"
                            return

                        async for line in response.aiter_lines():
                            if line.startswith("data: "):
                                data = line[6:]
                                if data == "[DONE]":
                                    break
                                yield f"data: {data}\n\n"
                        return  # success — exit retry loop

            except (httpx.ConnectError, httpx.TimeoutException) as e:
                if attempt < MAX_RETRIES:
                    await asyncio.sleep(2 ** attempt)
                    continue
                yield f"data: {json.dumps({'error': f'Connection failed after retries: {str(e)}'})}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'error': str(e)})}\n\n"
                return

    return StreamingResponse(stream(), media_type="text/event-stream")
