"""Chat endpoint — DeepSeek API proxy with SSE streaming."""

from fastapi import APIRouter

router = APIRouter(prefix="/api/ai", tags=["chat"])


@router.post("/chat")
async def chat():
    """Proxy chat requests to DeepSeek API, stream response via SSE."""
    return {"message": "not implemented"}
