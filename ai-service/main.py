"""Team Portal AI Service — FastAPI entry point."""

import os
import httpx
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from routes.chat import router as chat_router, configure_chat_http
from routes.search import router as search_router, configure_search_http, configure_search_index
from routes.logs import router as logs_router
from routes.parse import router as parse_router
from routes.documents import router as documents_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """性能 #6:模块级 httpx.AsyncClient 单例 — 复用 TCP/TLS 连接,省 RTT
    性能 #16:Semaphore 限流 DeepSeek 上游 — 防多用户同时打爆上游"""
    # TCP 连接池 + keep-alive + 上游并发上限
    app.state.http = httpx.AsyncClient(
        timeout=httpx.Timeout(60.0, connect=10.0),
        limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        http2=False,
    )
    app.state.upstream_sem = __import__("asyncio").Semaphore(8)
    configure_chat_http(app.state.http, app.state.upstream_sem)
    configure_search_http(app.state.http)
    # 性能 #7:知识库倒排索引构建(失败降级到按需扫描)
    try:
        await configure_search_index()
    except Exception as e:
        print(f"[WARN] KB 索引构建失败: {e}")
    yield
    await app.state.http.aclose()


# F-1 fix: gate docs / OpenAPI schema behind DEV env. Production disables both.
_DEV_MODE = os.environ.get("AI_SERVICE_ENV", "development").lower() != "production"
app = FastAPI(
    title="Team Portal AI Service",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs" if _DEV_MODE else None,
    openapi_url="/openapi.json" if _DEV_MODE else None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat_router)
app.include_router(search_router)
app.include_router(logs_router)
app.include_router(parse_router)
app.include_router(documents_router)


# ── Global exception handler ──
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"error": str(exc), "detail": "Internal server error"}
    )


@app.get("/")
async def root():
    return {"status": "ok", "service": "Team Portal AI Service"}


@app.get("/health")
async def health():
    return {"status": "healthy"}
