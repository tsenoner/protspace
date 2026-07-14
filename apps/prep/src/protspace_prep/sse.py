from __future__ import annotations
import json
from typing import Any

KEEPALIVE_FRAME = ":\n\n"


def format_event(event: str, data: dict[str, Any]) -> str:
    payload = json.dumps(data, separators=(",", ":"))
    return f"event: {event}\ndata: {payload}\n\n"
