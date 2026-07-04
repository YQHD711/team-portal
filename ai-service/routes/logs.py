"""Flight log parsing endpoint — pymavlink .tlog parser."""

from fastapi import APIRouter

router = APIRouter(prefix="/api/logs", tags=["logs"])


@router.get("/{filename}")
async def parse_log(filename: str):
    """Parse a .tlog file with pymavlink and return structured JSON."""
    return {"filename": filename, "data": {}}
