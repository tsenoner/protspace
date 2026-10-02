"""Shared HTTP utilities for UniProt-style REST API calls."""

import logging
import threading
import time
from collections import deque
from collections.abc import Callable, Iterable, Iterator
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from itertools import islice

import requests
from requests.adapters import HTTPAdapter

logger = logging.getLogger(__name__)

API_TIMEOUT = 30

# A Swiss-Prot-scale run issues thousands of sequential requests (UniProt is
# fetched 100 accessions at a time), so without retries a single transient blip
# is near-certain over a full run. Callers record a failed request as a
# permanent gap, so one unretried 503 costs a whole batch of proteins.
MAX_ATTEMPTS = 4
BACKOFF_BASE_SECONDS = 1.0
MAX_BACKOFF_SECONDS = 30.0
RETRYABLE_STATUS = frozenset({408, 425, 429, 500, 502, 503, 504})

# How many calls `map_in_order` submits ahead of the result it yields, per
# worker. Its results are taken in input order, so while one slow call holds
# up the next result the other workers only have this many calls to go on
# with: 64 covers an InterPro batch's whole retry budget (about two minutes at
# 4 workers) and a few seconds of TED lookups at 8, yet a 573K-accession
# input never holds 573K pending requests. A future is small; an InterPro
# batch's is up to the results the fetch keeps anyway.
_SUBMITTED_AHEAD_PER_WORKER = 64
# How many calls `map_as_completed` keeps submitted per worker. Results are
# taken as they finish, so one ready to start as a worker frees up is enough.
_QUEUED_PER_WORKER = 2


def _retry_after_seconds(response: requests.Response) -> float | None:
    """The wait a response's ``Retry-After`` asks for, capped; None without one."""
    try:
        # Clamped from below too: a negative or NaN ``Retry-After`` would
        # otherwise reach ``time.sleep`` and abort the whole fetch.
        seconds = float(response.headers.get("Retry-After", ""))
    except (TypeError, ValueError):
        return None
    return max(0.0, min(seconds, MAX_BACKOFF_SECONDS))


def _backoff_seconds(attempt: int, response: requests.Response | None) -> float:
    """Delay before *attempt* + 1, honouring ``Retry-After`` when the server sends it."""
    if response is not None:
        retry_after = _retry_after_seconds(response)
        if retry_after is not None:
            return retry_after
    return min(BACKOFF_BASE_SECONDS * 2 ** (attempt - 1), MAX_BACKOFF_SECONDS)


def _sleep(seconds: float, stop: threading.Event | None) -> bool:
    """Sleep *seconds*, or until *stop* is set; True when *stop* ended it."""
    if stop is None:
        time.sleep(seconds)
        return False
    return stop.wait(seconds)


class FetchStopped(requests.exceptions.RequestException):
    """A request not sent because the fetch it belongs to was stopped."""


class _RetryAfterPause:
    """When the next attempt of any request on one session may start."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._until = 0.0

    def extend(self, seconds: float) -> None:
        with self._lock:
            self._until = max(self._until, time.monotonic() + seconds)

    def wait(self, stop: threading.Event | None = None) -> bool:
        """Block until the pause is over; False when *stop* is set first."""
        # Checked again after every sleep: another request's `Retry-After`
        # may have moved the end later while this one slept.
        while (remaining := self._until - time.monotonic()) > 0:
            if _sleep(remaining, stop):
                return False
        return stop is None or not stop.is_set()


class PooledSession(requests.Session):
    """A session for many requests to one API, from up to *connections* threads.

    Reusing connections instead of opening one per request is most of the
    speed-up on its own (TED: 7 requests a second without, 16 with). The pool
    keeps *connections* per host, so that many threads never wait for a
    connection or throw one away.

    When a server answers a request on the session with ``Retry-After``, every
    later attempt the retry helpers make on the session waits until then, not
    only the request that received it: under concurrency the other workers
    would otherwise keep firing at a server that asked for a pause.

    ``stop`` is set when the fetch using the session ends early, as
    :func:`map_in_order` does when a breaker closes it or an interrupt ends
    it. From then on the retry helpers send nothing more on the session: a
    request waiting to retry gives up at once with the error of the attempt
    it made, and one not yet sent raises :class:`FetchStopped`.
    """

    def __init__(self, connections: int = 1) -> None:
        super().__init__()
        adapter = HTTPAdapter(pool_maxsize=max(1, connections))
        self.mount("https://", adapter)
        self.mount("http://", adapter)
        self.retry_after = _RetryAfterPause()
        self.stop = threading.Event()


def _request_with_retry(
    send: Callable[[], requests.Response],
    url: str,
    attempts: int,
    session: requests.Session | None = None,
) -> requests.Response:
    """Call *send* until it succeeds, retrying transient failures with backoff.

    The one retry loop behind :func:`get_with_retry` and :func:`post_with_retry`,
    so the GET and POST policies cannot drift apart. On a
    :class:`PooledSession`, a ``Retry-After`` is shared with every request on
    the session, and once the session's ``stop`` is set the attempt just made
    is the last.
    """
    pooled = session if isinstance(session, PooledSession) else None
    pause = pooled.retry_after if pooled else None
    stop = pooled.stop if pooled else None
    for attempt in range(1, attempts + 1):
        if pause is not None and not pause.wait(stop):
            raise FetchStopped(f"{url} was not requested: the fetch was stopped")
        response = None
        try:
            response = send()
            if response.status_code not in RETRYABLE_STATUS:
                response.raise_for_status()
                return response
        except (
            requests.Timeout,
            requests.ConnectionError,
            # A connection dropped mid-body: the request failed just as surely,
            # but it is not a ConnectionError.
            requests.exceptions.ChunkedEncodingError,
        ) as exc:
            if attempt == attempts:
                raise
            logger.debug(f"{url} failed ({exc}); retrying {attempt}/{attempts}")
            if _sleep(_backoff_seconds(attempt, None), stop):
                raise
            continue

        # Retryable status.
        retry_after = _retry_after_seconds(response)
        shared = pause is not None and retry_after is not None
        if shared:
            # Every request on the session holds off, this one included, even
            # when this attempt was its last.
            pause.extend(retry_after)
        if attempt == attempts:
            response.raise_for_status()
        delay = _backoff_seconds(attempt, response)
        logger.debug(
            f"{url} returned {response.status_code}; retrying in {delay:.1f}s "
            f"({attempt}/{attempts})"
        )
        stopped = not pause.wait(stop) if shared else _sleep(delay, stop)
        if stopped:
            # The attempt just made was the last.
            response.raise_for_status()

    # Unreachable: the final attempt either returns or raises above.
    raise RuntimeError(f"Exhausted retries for {url}")


def get_with_retry(
    url: str,
    params: dict | None = None,
    timeout: int = API_TIMEOUT,
    attempts: int = MAX_ATTEMPTS,
    session: requests.Session | None = None,
) -> requests.Response:
    """GET *url*, retrying transient failures with exponential backoff.

    Retries timeouts, connection errors and the status codes in
    ``RETRYABLE_STATUS``. A non-retryable 4xx is raised immediately: a bad
    accession does not become good by asking again.

    *attempts* lets a per-item caller lower the budget: a source fetched one
    request per protein cannot afford the default on a full outage, where the
    backoff would be paid hundreds of thousands of times.

    *session*, when given, sends the request and keeps its connection for the
    next one; without it each call opens a connection of its own.
    """
    client = requests if session is None else session
    return _request_with_retry(
        lambda: client.get(url, params=params, timeout=timeout),
        url,
        attempts,
        session,
    )


def post_with_retry(
    url: str,
    json: dict | list | None = None,
    headers: dict | None = None,
    timeout: int = API_TIMEOUT,
    attempts: int = MAX_ATTEMPTS,
    session: requests.Session | None = None,
) -> requests.Response:
    """POST *json* to *url* with the same retry policy as :func:`get_with_retry`.

    For batched lookups sent as a request body (InterPro's MD5 matches), where
    one lost request drops a whole batch of proteins.
    """
    client = requests if session is None else session
    return _request_with_retry(
        lambda: client.post(url, json=json, headers=headers, timeout=timeout),
        url,
        attempts,
        session,
    )


def paginated_get(
    url: str,
    params: dict | None = None,
    timeout: int = API_TIMEOUT,
    result_key: str = "results",
    on_response: Callable[[requests.Response], None] | None = None,
    session: requests.Session | None = None,
) -> list[dict]:
    """Fetch all pages from a UniProt-style REST API endpoint.

    Follows Link headers with rel="next" for automatic pagination.
    Returns the concatenated contents of the ``result_key`` array
    across all pages. Each page is fetched through :func:`get_with_retry`,
    and handed to *on_response*, when given, so a caller can read its headers.
    """
    results = []

    while url:
        resp = get_with_retry(url, params=params, timeout=timeout, session=session)
        if on_response is not None:
            on_response(resp)
        data = resp.json()
        results.extend(data.get(result_key, []))

        # Follow Link header for next page
        link = resp.headers.get("Link", "")
        url = None
        params = None  # next-page URL already contains all params
        if 'rel="next"' in link:
            url = link.split(";")[0].strip(" <>")

    return results


def _inline[T, R](
    fn: Callable[[T], R], items: Iterable[T], stop: threading.Event | None
) -> Iterator[R]:
    """``fn(item)`` for every item, one at a time, setting *stop* on an early end."""
    try:
        for item in items:
            yield fn(item)
    except BaseException:
        if stop is not None:
            stop.set()
        raise


def _abandon(
    executor: ThreadPoolExecutor, stop: threading.Event | None, exc: BaseException
) -> None:
    """Wind down a pass that ended early: set *stop*, so running calls give up
    after their current attempt, and cancel the calls not yet started."""
    if stop is not None:
        stop.set()
    # Ctrl-C must not sit behind the requests in flight; any other exit (an
    # error, or the caller closing the iterator) waits for them.
    executor.shutdown(
        wait=isinstance(exc, (Exception, GeneratorExit)), cancel_futures=True
    )


def map_in_order[T, R](
    fn: Callable[[T], R],
    items: Iterable[T],
    workers: int,
    stop: threading.Event | None = None,
) -> Iterator[R]:
    """Yield ``fn(item)`` for every item, in input order, *workers* calls at a time.

    For sources fetched one request per protein or per batch whose caller
    counts results in input order (an outage breaker's failures in a row):
    the requests overlap, while the caller sees the results in the order it
    asked for them, so its accounting is the same as one request at a time.
    *fn* should return its errors rather than raise them; one it raises ends
    the iteration at that item.

    At most ``_SUBMITTED_AHEAD_PER_WORKER * workers`` calls are submitted
    ahead of the result being yielded, so a slow call leaves the other
    workers that many calls to go on with. With ``workers <= 1`` each call
    runs inline, when its result is needed.

    When the iteration ends early -- the caller closes it, as an outage
    breaker does, or an error or interrupt ends it -- *stop* is set (pass the
    session's ``PooledSession.stop``, so the calls still running give up
    after their current attempt), the calls not yet started are cancelled,
    and the running ones are waited for, so no request outlives the fetch.
    An interrupt does not wait for them.
    """
    if workers <= 1:
        yield from _inline(fn, items, stop)
        return

    source = iter(items)
    executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="protspace")
    try:
        pending = deque(
            executor.submit(fn, item)
            for item in islice(source, workers * _SUBMITTED_AHEAD_PER_WORKER)
        )
        while pending:
            result = pending.popleft().result()
            for item in islice(source, 1):
                pending.append(executor.submit(fn, item))
            yield result
    except BaseException as exc:
        _abandon(executor, stop, exc)
        raise
    executor.shutdown()


def map_as_completed[T, R](
    fn: Callable[[T], R],
    items: Iterable[T],
    workers: int,
    stop: threading.Event | None = None,
) -> Iterator[tuple[int, R]]:
    """Yield ``(index, fn(item))`` for every item as its call finishes.

    For a pass whose caller files each result by its index and counts
    nothing in input order (TED's first pass): a slow call holds up only its
    own worker while the others go on to the next items, however long it
    takes. At most ``_QUEUED_PER_WORKER * workers`` calls are submitted and
    not yet yielded. Results finishing together are yielded in input order.

    Otherwise as :func:`map_in_order`: *workers* calls at a time, inline and
    in input order with ``workers <= 1``, and an early end sets *stop*,
    cancels the calls not yet started and waits for the running ones.
    """
    if workers <= 1:
        yield from _inline(lambda pair: (pair[0], fn(pair[1])), enumerate(items), stop)
        return

    source = enumerate(items)
    window = workers * _QUEUED_PER_WORKER
    executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="protspace")
    running: dict[Future[R], int] = {}
    try:
        while True:
            for index, item in islice(source, window - len(running)):
                running[executor.submit(fn, item)] = index
            if not running:
                break
            done, _ = wait(running, return_when=FIRST_COMPLETED)
            for future in sorted(done, key=running.__getitem__):
                yield running.pop(future), future.result()
    except BaseException as exc:
        _abandon(executor, stop, exc)
        raise
    executor.shutdown()
