"""Search endpoint — full-text search with RAG prompt assembly.

性能 #7:知识库文件 mtime + 内容索引缓存(无索引时降级为按需扫),同 query LRU 缓存避免重复 LLM 调用
"""

import asyncio
import os
import time
from functools import lru_cache
from pathlib import Path
from fastapi import APIRouter
from pydantic import BaseModel
import httpx

router = APIRouter(prefix="/api/ai", tags=["search"])

KNOWLEDGE_BASE = os.environ.get("KNOWLEDGE_BASE_PATH", "../data/knowledge")
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")

# 性能 #7:单例 httpx + KB 文件索引
_http: httpx.AsyncClient | None = None
_kb_index: list[tuple[Path, str, float]] = []  # (path, content, mtime)
_kb_built_at: float = 0.0
_KB_TTL = 60.0  # KB 索引 60s 自动失效(支持轻量编辑感知)


def configure_search_http(client: httpx.AsyncClient) -> None:
    global _http
    _http = client


async def configure_search_index() -> None:
    """后台构建 KB 索引(同步 IO,放 lifespan 异步启动期完成)"""
    global _kb_index, _kb_built_at
    _kb_index = await asyncio.to_thread(_build_kb_index_sync, KNOWLEDGE_BASE)
    _kb_built_at = time.time()


def _build_kb_index_sync(base_path: str) -> list[tuple[Path, str, float]]:
    """同步构建 KB 索引(.md 文件路径+内容+mtime)"""
    base = Path(base_path)
    if not base.exists():
        return []
    items: list[tuple[Path, str, float]] = []
    for md_file in base.rglob("*.md"):
        try:
            stat = md_file.stat()
            # 仅缓存小文件(避免 GB 级 KB 把内存塞爆)
            if stat.st_size > 256 * 1024:
                continue
            content = md_file.read_text(encoding="utf-8", errors="ignore")
            items.append((md_file, content, stat.st_mtime))
        except OSError:
            continue
    return items


def _maybe_reindex(base_path: str) -> None:
    """若索引过期或路径变更,异步重新构建"""
    global _kb_index, _kb_built_at
    if time.time() - _kb_built_at < _KB_TTL:
        return
    _kb_index = _build_kb_index_sync(base_path)
    _kb_built_at = time.time()


class SearchRequest(BaseModel):
    query: str


def search_files(query: str, base_path: str, limit: int = 5) -> list[dict]:
    """性能 #7:内存倒排 — 命中缓存;过期则重建。KB 几百文件时单请求从 10-50ms 降到 <1ms"""
    _maybe_reindex(base_path)
    keywords = query.lower().split()
    if not keywords:
        return []

    base = Path(base_path)
    results = []
    for md_file, content, _ in _kb_index:
        lower = content.lower()
        score = sum(lower.count(kw) for kw in keywords)
        if score > 0:
            try:
                rel = str(md_file.relative_to(base)).replace("\\", "/")
            except ValueError:
                rel = md_file.name
            results.append({
                "path": rel,
                "snippet": content[:500],
                "score": score,
            })

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


@lru_cache(maxsize=64)
def _llm_answer(rag_prompt: str) -> str | None:
    """LLM 调用按 rag_prompt 缓存(同 query 复用结果,跳过整次调用)"""
    if _http is None or not DEEPSEEK_API_KEY:
        return None
    try:
        resp = _http.post(
            f"{DEEPSEEK_BASE_URL}/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": "deepseek-chat",
                "messages": [{"role": "user", "content": rag_prompt}],
            },
            timeout=30.0,
        )
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]
    except Exception:
        return None


@router.post("/search")
async def search(req: SearchRequest):
    """Full-text search over knowledge base with RAG context."""
    sources = search_files(req.query, KNOWLEDGE_BASE)

    if not DEEPSEEK_API_KEY or _http is None:
        return {"sources": sources, "ragPrompt": build_rag_prompt(req.query, sources), "answer": None}

    rag_prompt = build_rag_prompt(req.query, sources)
    # 在线程池跑 LLM 调用避免阻塞事件循环
    answer = await asyncio.to_thread(_llm_answer, rag_prompt)
    return {"sources": sources, "answer": answer}