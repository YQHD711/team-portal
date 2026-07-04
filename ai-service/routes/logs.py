"""Flight log parsing endpoint — pymavlink .tlog parser."""

import json
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/logs", tags=["logs"])

LOG_DIR = Path("../data/flightlogs")


class ParseRequest(BaseModel):
    filename: str


def extract_basic_info(filepath: Path) -> dict:
    """Extract basic flight info from .tlog without pymavlink (fallback)."""
    # Try pymavlink first
    try:
        from pymavlink import mavutil
        mlog = mavutil.mavlink_connection(str(filepath))
        messages = []
        altitudes = []
        timestamps = []

        while True:
            msg = mlog.recv_match(blocking=False)
            if msg is None:
                break
            msg_dict = msg.to_dict()
            messages.append(msg_dict)
            if msg_dict.get("mavpackettype") == "GLOBAL_POSITION_INT":
                alt = msg_dict.get("relative_alt", 0) / 1000.0
                if alt != 0:
                    altitudes.append(alt)
                    timestamps.append(msg_dict.get("_timestamp", 0))

        return {
            "filename": filepath.name,
            "messageCount": len(messages),
            "maxAltitude": max(altitudes) if altitudes else None,
            "minAltitude": min(altitudes) if altitudes else None,
            "duration": (max(timestamps) - min(timestamps)) if len(timestamps) > 1 else None,
            "altitudeSeries": [{"t": t, "alt": a} for t, a in zip(timestamps, altitudes)][:500],
        }
    except ImportError:
        pass

    # Fallback: return file info only
    stat = filepath.stat()
    return {
        "filename": filepath.name,
        "size": stat.st_size,
        "modified": stat.st_mtime,
        "messageCount": 0,
        "maxAltitude": None,
        "minAltitude": None,
        "duration": None,
        "altitudeSeries": [],
        "note": "pymavlink not installed — install with: pip install pymavlink",
    }


@router.post("/parse")
async def parse_log(req: ParseRequest):
    """Parse a .tlog file and return structured JSON."""
    filepath = LOG_DIR / req.filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {req.filename}")

    return extract_basic_info(filepath)


@router.get("/list")
async def list_logs():
    """Scan log directory and return summary list."""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logs = []
    for f in sorted(LOG_DIR.glob("*.tlog"), key=lambda f: f.stat().st_mtime, reverse=True):
        stat = f.stat()
        logs.append({
            "filename": f.name,
            "size": stat.st_size,
            "modified": stat.st_mtime,
        })
    return {"logs": logs}
