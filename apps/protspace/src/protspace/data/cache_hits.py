"""Which stages of a run reused a result an earlier run cached.

Each stage notes a hit where it decides to reuse its cache, so the rule stays
in the stage that owns it. A stage is noted by the `--refetch` token that
recomputes it, which is what `prepare` names in its hint after a run that
reused something.
"""

from contextvars import ContextVar

_hits: ContextVar[list[str] | None] = ContextVar("cache_hits", default=None)


def record_cache_hits() -> list[str]:
    """Record this context's cache hits into a new list, and return it.

    Hits go to the most recent list until the next call; before the first
    call they are dropped. A worker thread starts with its own context, so a
    hit noted there is not recorded.
    """
    hits: list[str] = []
    _hits.set(hits)
    return hits


def note_cache_hit(stage: str) -> None:
    """Record that *stage*, a `--refetch` token, reused a cached result."""
    hits = _hits.get()
    if hits is not None:
        hits.append(stage)
