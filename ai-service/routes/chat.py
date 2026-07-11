"""Chat endpoint — DeepSeek API proxy with SSE streaming."""

import asyncio
import json
import os
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import httpx

router = APIRouter(prefix="/api/ai", tags=["chat"])

DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
MAX_RETRIES = 2


class ChatRequest(BaseModel):
    question: str


@router.post("/chat")
async def chat(req: ChatRequest):
    """Proxy chat requests to DeepSeek API, stream response via SSE."""
    async def stream():
        if not DEEPSEEK_API_KEY:
            yield f"data: {json.dumps({'error': 'DEEPSEEK_API_KEY not configured'})}\n\n"
            return

        for attempt in range(MAX_RETRIES + 1):
            try:
                async with httpx.AsyncClient(timeout=60.0) as client:
                    async with client.stream(
                        "POST",
                        f"{DEEPSEEK_BASE_URL}/v1/chat/completions",
                        headers={
                            "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
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
