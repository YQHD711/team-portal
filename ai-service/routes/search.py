"""Search endpoint — full-text search with RAG prompt assembly."""

import os
from pathlib import Path
from fastapi import APIRouter
from pydantic import BaseModel
import httpx

router = APIRouter(prefix="/api/ai", tags=["search"])

KNOWLEDGE_BASE = os.environ.get("KNOWLEDGE_BASE_PATH", "../data/knowledge")
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")


class SearchRequest(BaseModel):
    query: str


def search_files(query: str, base_path: str, limit: int = 5) -> list[dict]:
    """Simple full-text search over .md files in knowledge base."""
    results = []
    base = Path(base_path)
    if not base.exists():
        return results

    keywords = query.lower().split()
    for md_file in base.rglob("*.md"):
        try:
            content = md_file.read_text(encoding="utf-8")
            score = sum(content.lower().count(kw) for kw in keywords)
            if score > 0:
                results.append({
                    "path": str(md_file.relative_to(base)).replace("\\", "/"),
                    "snippet": content[:500],
                    "score": score,
                })
        except Exception:
            continue

    results.sort(key=lambda r: r["score"], reverse=True)
    return results[:limit]


def build_rag_prompt(query: str, sources: list[dict]) -> str:
    """Assemble a RAG prompt with context from search results."""
    if not sources:
        return query

    context = "\n\n---\n\n".join(
        f"Source: {s['path']}\n{s['snippet']}" for s in sources
    )
    return (
        f"请根据以下参考资料回答问题。如果参考资料中没有相关信息，请直接说不知道。\n\n"
        f"## 参考资料\n{context}\n\n"
        f"## 问题\n{query}\n\n"
        f"## 回答"
    )


@router.post("/search")
async def search(req: SearchRequest):
    """Full-text search over knowledge base with RAG context."""
    sources = search_files(req.query, KNOWLEDGE_BASE)

    if not DEEPSEEK_API_KEY:
        return {"sources": sources, "ragPrompt": build_rag_prompt(req.query, sources), "answer": None}

    rag_prompt = build_rag_prompt(req.query, sources)
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{DEEPSEEK_BASE_URL}/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "deepseek-chat",
                    "messages": [{"role": "user", "content": rag_prompt}],
                },
            )
            resp.raise_for_status()
            data = resp.json()
            answer = data["choices"][0]["message"]["content"]
    except Exception as e:
        return {"sources": sources, "answer": None, "error": f"AI query failed: {str(e)}"}

    return {"sources": sources, "answer": answer}
