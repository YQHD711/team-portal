"""Chat endpoint — DeepSeek API proxy with SSE streaming."""

import json
import os
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import httpx

router = APIRouter(prefix="/api/ai", tags=["chat"])

DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")


class ChatRequest(BaseModel):
    question: str


@router.post("/chat")
async def chat(req: ChatRequest):
    """Proxy chat requests to DeepSeek API, stream response via SSE."""
    async def stream():
        if not DEEPSEEK_API_KEY:
            yield f"data: {json.dumps({'error': 'DEEPSEEK_API_KEY not configured'})}\n\n"
            return

        async with httpx.AsyncClient(timeout=60.0) as client:
            try:
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
                        yield f"data: {json.dumps({'error': f'DeepSeek API error: {text.decode()}'})}\n\n"
                        return

                    async for line in response.aiter_lines():
                        if line.startswith("data: "):
                            data = line[6:]
                            if data == "[DONE]":
                                break
                            yield f"data: {data}\n\n"

            except Exception as e:
                yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")
