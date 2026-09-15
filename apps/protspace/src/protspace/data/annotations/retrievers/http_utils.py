"""Shared HTTP utilities for UniProt-style REST API calls."""

import logging
import time

import requests

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


def _backoff_seconds(attempt: int, response: requests.Response | None) -> float:
    """Delay before *attempt* + 1, honouring ``Retry-After`` when the server sends it."""
    if response is not None:
        retry_after = response.headers.get("Retry-After", "")
        try:
            # Clamped from below too: a negative or NaN ``Retry-After`` would
            # otherwise reach ``time.sleep`` and abort the whole fetch.
            return max(0.0, min(float(retry_after), MAX_BACKOFF_SECONDS))
        except ValueError:
            pass
    return min(BACKOFF_BASE_SECONDS * 2 ** (attempt - 1), MAX_BACKOFF_SECONDS)


def get_with_retry(
    url: str,
    params: dict | None = None,
    timeout: int = API_TIMEOUT,
    attempts: int = MAX_ATTEMPTS,
) -> requests.Response:
    """GET *url*, retrying transient failures with exponential backoff.

    Retries timeouts, connection errors and the status codes in
    ``RETRYABLE_STATUS``. A non-retryable 4xx is raised immediately: a bad
    accession does not become good by asking again.

    *attempts* lets a per-item caller lower the budget: a source fetched one
    request per protein cannot afford the default on a full outage, where the
    backoff would be paid hundreds of thousands of times.
    """
    for attempt in range(1, attempts + 1):
        response = None
        try:
            response = requests.get(url, params=params, timeout=timeout)
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
            time.sleep(_backoff_seconds(attempt, None))
            continue

        # Retryable status.
        if attempt == attempts:
            response.raise_for_status()
        delay = _backoff_seconds(attempt, response)
        logger.debug(
            f"{url} returned {response.status_code}; retrying in {delay:.1f}s "
            f"({attempt}/{attempts})"
        )
        time.sleep(delay)

    # Unreachable: the final attempt either returns or raises above.
    raise RuntimeError(f"Exhausted retries for {url}")


def paginated_get(
    url: str,
    params: dict | None = None,
    timeout: int = API_TIMEOUT,
    result_key: str = "results",
) -> list[dict]:
    """Fetch all pages from a UniProt-style REST API endpoint.

    Follows Link headers with rel="next" for automatic pagination.
    Returns the concatenated contents of the ``result_key`` array
    across all pages. Each page is fetched through :func:`get_with_retry`.
    """
    results = []

    while url:
        resp = get_with_retry(url, params=params, timeout=timeout)
        data = resp.json()
        results.extend(data.get(result_key, []))

        # Follow Link header for next page
        link = resp.headers.get("Link", "")
        url = None
        params = None  # next-page URL already contains all params
        if 'rel="next"' in link:
            url = link.split(";")[0].strip(" <>")

    return results
