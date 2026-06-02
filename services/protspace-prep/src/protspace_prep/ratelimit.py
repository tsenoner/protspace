from __future__ import annotations

from slowapi import Limiter
from starlette.requests import Request


def client_key(request: Request) -> str:
    """Rate-limit bucket key: the real client IP behind the Caddy gateway.

    Prefers the first hop of X-Forwarded-For (the original client), since the
    socket peer is the gateway. Falls back to the peer, then a constant.

    SECURITY: this trusts X-Forwarded-For unconditionally. That is safe ONLY
    because the backend port is published on a private LAN IP and firewalled
    to the gateway nodes - untrusted clients cannot reach it to spoof the
    header. See the deployment plan's security invariant.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    if request.client is not None:
        return request.client.host
    return "unknown"


def make_limiter() -> Limiter:
    return Limiter(key_func=client_key, default_limits=[], headers_enabled=True)
