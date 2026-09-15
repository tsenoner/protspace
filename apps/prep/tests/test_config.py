import pytest

from protspace_prep.config import (
    PUBLISHED_RETENTION_BOUND_SECONDS,
    load_settings,
)


def test_cors_origins_parsed_from_env(monkeypatch):
    monkeypatch.setenv(
        "CORS_ALLOWED_ORIGIN", "https://protspace.app, https://staging.protspace.app"
    )
    settings = load_settings()
    assert settings.cors_allowed_origins == (
        "https://protspace.app",
        "https://staging.protspace.app",
    )


def test_cors_origins_empty_when_unset(monkeypatch):
    monkeypatch.delenv("CORS_ALLOWED_ORIGIN", raising=False)
    assert load_settings().cors_allowed_origins == ()


def test_rate_limit_default_and_override(monkeypatch):
    monkeypatch.delenv("PREP_RATE_LIMIT", raising=False)
    assert load_settings().rate_limit == "5/15minutes"
    monkeypatch.setenv("PREP_RATE_LIMIT", "2/minute")
    assert load_settings().rate_limit == "2/minute"


def test_cors_origins_trailing_comma(monkeypatch):
    monkeypatch.setenv("CORS_ALLOWED_ORIGIN", "https://a.com,")
    assert load_settings().cors_allowed_origins == ("https://a.com",)


def test_rate_limit_blank_falls_back_to_default(monkeypatch):
    monkeypatch.setenv("PREP_RATE_LIMIT", "   ")
    assert load_settings().rate_limit == "5/15minutes"


def test_retention_worst_case_sums_the_three_contributing_settings(monkeypatch):
    monkeypatch.setenv("PREP_PIPELINE_TIMEOUT_SECONDS", "100")
    monkeypatch.setenv("PREP_BUNDLE_TTL_SECONDS", "200")
    monkeypatch.setenv("PREP_SWEEP_INTERVAL_SECONDS", "30")
    assert load_settings().retention_worst_case_seconds == 330


def test_shipped_defaults_stay_within_the_published_retention_bound(monkeypatch):
    for name in (
        "PREP_PIPELINE_TIMEOUT_SECONDS",
        "PREP_BUNDLE_TTL_SECONDS",
        "PREP_SWEEP_INTERVAL_SECONDS",
    ):
        monkeypatch.delenv(name, raising=False)
    assert (
        load_settings().retention_worst_case_seconds
        <= PUBLISHED_RETENTION_BOUND_SECONDS
    )


def test_ttl_beyond_the_published_bound_refuses_to_start(monkeypatch):
    # The failure mode this guards: someone raises the TTL for an unrelated
    # reason and silently makes the published privacy page a false statement.
    monkeypatch.setenv(
        "PREP_BUNDLE_TTL_SECONDS", str(PUBLISHED_RETENTION_BOUND_SECONDS)
    )
    with pytest.raises(ValueError, match="exceeds"):
        load_settings()


def test_violation_message_names_the_page_and_the_settings(monkeypatch):
    monkeypatch.setenv("PREP_BUNDLE_TTL_SECONDS", "999999")
    with pytest.raises(ValueError) as excinfo:
        load_settings()
    message = str(excinfo.value)
    assert "Privacy.tsx" in message
    assert "PREP_BUNDLE_TTL_SECONDS=999999" in message


def test_bound_is_not_breached_by_the_other_two_settings(monkeypatch):
    # The TTL is the obvious dial, but the sweep interval and pipeline timeout
    # count toward the same promise and must be guarded too.
    monkeypatch.setenv(
        "PREP_SWEEP_INTERVAL_SECONDS", str(PUBLISHED_RETENTION_BOUND_SECONDS)
    )
    with pytest.raises(ValueError, match="exceeds"):
        load_settings()
