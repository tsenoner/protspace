"""Shared HTTP utilities for UniProt-style REST API calls."""

import logging

import requests

logger = logging.getLogger(__name__)

API_TIMEOUT = 30


def paginated_get(
    url: str,
    params: dict | None = None,
    timeout: int = API_TIMEOUT,
    result_key: str = "results",
) -> list[dict]:
    """Fetch all pages from a UniProt-style REST API endpoint.

    Follows Link headers with rel="next" for automatic pagination.
    Returns the concatenated contents of the ``result_key`` array
    across all pages.
    """
    results = []

    while url:
        resp = requests.get(url, params=params, timeout=timeout)
        resp.raise_for_status()
        data = resp.json()
        results.extend(data.get(result_key, []))

        # Follow Link header for next page
        link = resp.headers.get("Link", "")
        url = None
        params = None  # next-page URL already contains all params
        if 'rel="next"' in link:
            url = link.split(";")[0].strip(" <>")

    return results
