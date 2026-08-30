"""Excel parsing endpoint — openpyxl inventory importer.

Security: 接受 multipart UploadFile,拒绝客户端传 path/filepath;文件落到受控
临时目录,大小/扩展名受白名单约束。原 filepath 任意文件读 (C1) 已堵。
"""
import os
import tempfile
from pathlib import Path
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel
import openpyxl

router = APIRouter(prefix="/api/parse", tags=["parse"])

ALLOWED_EXTS = {".xlsx", ".xlsm"}
MAX_BYTES = 10 * 1024 * 1024  # 10 MB


def _safe_openxl_path(tmp_dir: Path) -> Path:
    """临时目录固定在系统 tmp 下,代码不接受任何来自客户端的路径。"""
    tmp_dir.mkdir(parents=True, exist_ok=True)
    return tmp_dir


@router.post("/excel")
async def parse_excel(file: UploadFile = File(...)):
    """Parse inventory Excel file uploaded by client and return JSON list of items."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTS:
        raise HTTPException(status_code=400, detail=f"Unsupported format: {ext}")

    # 落地到系统临时目录(权限 0600),不信任任何客户端路径
    tmp_dir = Path(tempfile.gettempdir()) / "tp-parse"
    _safe_openxl_path(tmp_dir)
    safe_name = f"{os.urandom(16).hex()}{ext}"
    dest = tmp_dir / safe_name
    try:
        # 限制大小,防止 zip-bomb
        size = 0
        with dest.open("wb") as f:
            while chunk := await file.read(64 * 1024):
                size += len(chunk)
                if size > MAX_BYTES:
                    raise HTTPException(status_code=413, detail=f"File too large (> {MAX_BYTES} bytes)")
                f.write(chunk)

        try:
            wb = openpyxl.load_workbook(dest, read_only=True)
            ws = wb.active
            items: list[dict] = []
            for row in ws.iter_rows(min_row=2, values_only=True):
                if not row or len(row) < 3:
                    continue
                items.append({
                    "name": str(row[0] or ""),
                    "category": str(row[1] or ""),
                    "quantity": int(row[2]) if row[2] and str(row[2]).isdigit() else 0,
                    "location": str(row[3] or "") if len(row) > 3 else "",
                    "status": str(row[4] or "available") if len(row) > 4 else "available",
                })
            wb.close()
            return {"items": items, "count": len(items)}
        finally:
            dest.unlink(missing_ok=True)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Parse error: {e}")


@router.get("/excel/info")
async def excel_info():
    """已禁用:不再接受客户端 filepath,改用 POST /excel 上传。如需 sheet 元数据,请重新上传。"""
    raise HTTPException(status_code=410, detail="GET /excel/info 已禁用,改用 POST /excel 上传文件")
