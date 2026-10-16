"""Which stages of a run reused a result an earlier run cached.

Each stage notes a hit where it decides to reuse its cache, beside its "Using
cached ..." warning, so the rule stays in the stage that owns it. `prepare`
reads them to name `--refetch` only after a run that reused something.
"""

from contextvars import ContextVar

_hits: ContextVar[list[str] | None] = ContextVar("cache_hits", default=None)


def record_cache_hits() -> list[str]:
    """Start recording cache hits; return the list they are appended to.

    A later call starts a new list. Without a call, hits are not recorded.
    """
    hits: list[str] = []
    _hits.set(hits)
    return hits


def note_cache_hit(stage: str) -> None:
    """Record that *stage* reused a cached result."""
    hits = _hits.get()
    if hits is not None:
        hits.append(stage)
