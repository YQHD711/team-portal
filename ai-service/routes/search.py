"""Search endpoint — full-text search with RAG prompt assembly."""

from fastapi import APIRouter

router = APIRouter(prefix="/api/ai", tags=["search"])


@router.post("/search")
async def search():
    """Full-text search over knowledge base with RAG context."""
    return {"results": []}
