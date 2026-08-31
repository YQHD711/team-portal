"""Pytest config — add ai-service to sys.path so `from main import app` works.

Path resolved relative to this file (no reliance on CWD).
"""
import sys
from pathlib import Path

_AI_SERVICE_DIR = (Path(__file__).parent.parent.parent / "ai-service").resolve()
if str(_AI_SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(_AI_SERVICE_DIR))
