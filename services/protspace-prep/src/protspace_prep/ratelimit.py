from __future__ import annotations

from slowapi import Limiter
from starlette.requests import Request


def client_key(request: Request) -> str:
    """Rate-limit bucket key: the real client IP as resolved by uvicorn.

    We rely entirely on uvicorn's ProxyHeaders middleware to resolve the real
    client. It is gated by ``FORWARDED_ALLOW_IPS`` (set to the trusted private
    LAN subnet), so for a trusted peer ``request.client.host`` is already the
    original client (rewritten from ``X-Forwarded-For``), and for an untrusted
    peer it is that peer's own socket address. We no longer parse the raw
    ``X-Forwarded-For`` header ourselves — doing so would bypass that trust
    gate and let any client spoof the header. The trust boundary is the
    firewalled private LAN subnet that only the gateway nodes can reach.
    """
    if request.client is not None:
        return request.client.host
    return "unknown"


def make_limiter() -> Limiter:
    return Limiter(key_func=client_key, default_limits=[], headers_enabled=True)
