"""Document processing — extract text from PDF/DOCX files."""

from pathlib import Path
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/documents", tags=["documents"])


def extract_pdf(filepath: str) -> str:
    try:
        from PyPDF2 import PdfReader
        reader = PdfReader(filepath)
        text = ""
        for page in reader.pages[:50]:  # max 50 pages
            t = page.extract_text()
            if t:
                text += t + "\n\n"
        return text.strip() or "(PDF has no extractable text)"
    except ImportError:
        return "(PyPDF2 not installed)"
    except Exception as e:
        return f"(PDF extraction error: {str(e)})"


def extract_docx(filepath: str) -> str:
    try:
        from docx import Document
        doc = Document(filepath)
        text = "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())
        return text.strip() or "(DOCX has no extractable text)"
    except ImportError:
        return "(python-docx not installed)"
    except Exception as e:
        return f"(DOCX extraction error: {str(e)})"


@router.post("/extract")
async def extract_text(filepath: str):
    """Extract text from PDF/DOCX and return as markdown-ready content."""
    path = Path(filepath)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {filepath}")

    ext = path.suffix.lower()
    if ext == ".pdf":
        text = extract_pdf(str(path))
    elif ext == ".docx":
        text = extract_docx(str(path))
    elif ext in (".md", ".txt"):
        text = path.read_text(encoding="utf-8", errors="ignore")
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported format: {ext}")

    return {"filename": path.name, "text": text, "length": len(text)}
