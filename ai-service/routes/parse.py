"""Excel parsing endpoint — openpyxl inventory importer."""

from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import openpyxl

router = APIRouter(prefix="/api/parse", tags=["parse"])


class InventoryItem(BaseModel):
    name: str
    category: str
    quantity: int
    location: str
    status: str = "available"


@router.post("/excel")
async def parse_excel(filepath: str):
    """Parse inventory Excel file and return JSON list of items."""
    path = Path(filepath)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {filepath}")

    try:
        wb = openpyxl.load_workbook(path, read_only=True)
        ws = wb.active

        items: list[dict] = []
        # Skip header row
        for row in list(ws.iter_rows(min_row=2, values_only=True))[0:]:
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
        return {"items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Parse error: {str(e)}")


@router.get("/excel/info")
async def excel_info(filepath: str):
    """Return sheet names and row count for an Excel file."""
    path = Path(filepath)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {filepath}")

    wb = openpyxl.load_workbook(path, read_only=True)
    sheets = [{"name": s, "rows": wb[s].max_row} for s in wb.sheetnames]
    wb.close()
    return {"sheets": sheets}
