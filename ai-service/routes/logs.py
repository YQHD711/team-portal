"""Flight log parsing endpoint — pymavlink .tlog parser.

Security: filename 必须解析后落在 LOG_DIR 内（is_relative_to 守卫）,消息
数上限防 zip-bomb 类恶意日志耗尽内存。原路径遍历 (C3) 已堵。
性能 #4:解析移出事件循环(asyncio.to_thread),asyncio.timeout 兜底;finally 释放 pymavlink 句柄。
"""
import asyncio
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/logs", tags=["logs"])

# 用 __file__ 解析 LOG_DIR 而非相对路径 "../data/...",防 CWD 漂移导致越界
LOG_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "flightlogs"
MAX_MESSAGES = 50_000  # pymavlink 解析消息上限(防 zip-bomb)


def _safe_log_path(filename: str) -> Path:
    """解析 filename 后必须仍在 LOG_DIR 内,否则 404。"""
    if not filename or "/" in filename or "\\" in filename or filename.startswith("."):
        raise HTTPException(status_code=400, detail="Invalid filename")
    candidate = (LOG_DIR / filename).resolve()
    try:
        candidate.relative_to(LOG_DIR.resolve())
    except ValueError:
        raise HTTPException(status_code=404, detail="File not found")
    return candidate


class ParseRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=255)


def extract_basic_info(filepath: Path) -> dict:
    """Extract basic flight info from .tlog without pymavlink (fallback)."""
    # Try pymavlink first
    mlog = None
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
            if len(messages) >= MAX_MESSAGES:
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
            "truncated": len(messages) >= MAX_MESSAGES,
        }
    except ImportError:
        pass
    finally:
        # 性能 #4:释放 pymavlink 句柄(原每次请求泄漏 1 个 fd)
        if mlog is not None:
            try: mlog.close()
            except Exception: pass

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
    filepath = _safe_log_path(req.filename)
    if not filepath.exists() or filepath.suffix.lower() != ".tlog":
        raise HTTPException(status_code=404, detail=f"File not found: {req.filename}")

    # 性能 #4:解析移出事件循环 → 单 worker 不会因一个慢解析卡死所有请求
    # asyncio.timeout 兜底:防止恶意/异常大文件导致线程池被无限占用
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(extract_basic_info, filepath),
            timeout=30.0,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail=f"解析超时(>30s): {req.filename}")


@router.get("/list")
async def list_logs():
    """Scan log directory and return summary list (only direct .tlog children)."""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logs = []
    # 仅列直接子项,用 iterdir 避免 symlink 越界 + relative_to 守卫
    for f in sorted(LOG_DIR.iterdir(), key=lambda f: f.stat().st_mtime, reverse=True):
        if not f.is_file() or f.suffix.lower() != ".tlog":
            continue
        try:
            f.resolve().relative_to(LOG_DIR.resolve())
        except ValueError:
            continue
        stat = f.stat()
        logs.append({
            "filename": f.name,
            "size": stat.st_size,
            "modified": stat.st_mtime,
        })
    return {"logs": logs}
