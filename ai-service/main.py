"""Team Portal AI Service — FastAPI entry point."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes.chat import router as chat_router
from routes.search import router as search_router
from routes.logs import router as logs_router
from routes.parse import router as parse_router

app = FastAPI(title="Team Portal AI Service", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat_router)
app.include_router(search_router)
app.include_router(logs_router)
app.include_router(parse_router)


@app.get("/")
async def root():
    return {"status": "ok", "service": "Team Portal AI Service"}


@app.get("/health")
async def health():
    return {"status": "healthy"}
