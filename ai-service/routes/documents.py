"""Document processing — extract text from PDF/DOCX files."""

import shutil
import tempfile
from pathlib import Path
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/documents", tags=["documents"])


def extract_pdf(filepath: str) -> str:
    from PyPDF2 import PdfReader
    reader = PdfReader(filepath)
    text = ""
    for page in reader.pages[:50]:  # max 50 pages
        t = page.extract_text()
        if t:
            text += t + "\n\n"
    return text.strip() or ""


def extract_docx(filepath: str) -> str:
    from docx import Document
    path = Path(filepath)
    if not path.exists():
        raise FileNotFoundError(f"DOCX file not found: {filepath}")
    try:
        doc = Document(str(path))
    except Exception:
        # python-docx on Windows may fail on non-ASCII paths; copy to temp ASCII path
        suffix = path.suffix
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmpname = tmp.name
        try:
            shutil.copy2(str(path), tmpname)
            doc = Document(tmpname)
        finally:
            Path(tmpname).unlink(missing_ok=True)
    text = "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())
    return text.strip() or ""


@router.post("/extract")
async def extract_text(filepath: str):
    """Extract text from PDF/DOCX and return as markdown-ready content."""
    path = Path(filepath)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {filepath}")

    ext = path.suffix.lower()
    try:
        if ext == ".pdf":
            text = extract_pdf(str(path))
        elif ext == ".docx":
            text = extract_docx(str(path))
        elif ext in (".md", ".txt"):
            text = path.read_text(encoding="utf-8", errors="ignore")
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported format: {ext}")
    except ImportError as e:
        raise HTTPException(status_code=500, detail=f"Missing dependency: {e}")
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"{ext} extraction error: {e}")

    if not text:
        raise HTTPException(status_code=422, detail=f"No extractable text in {ext} file")

    return {"filename": path.name, "text": text, "length": len(text)}
