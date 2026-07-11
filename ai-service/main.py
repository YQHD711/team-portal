"""Team Portal AI Service — FastAPI entry point."""

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from routes.chat import router as chat_router
from routes.search import router as search_router
from routes.logs import router as logs_router
from routes.parse import router as parse_router
from routes.documents import router as documents_router

app = FastAPI(title="Team Portal AI Service", version="0.1.0")

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
