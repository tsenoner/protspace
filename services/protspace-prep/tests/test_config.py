import pytest

from protspace_prep.config import _parse_bool, load_settings


def test_cors_origins_parsed_from_env(monkeypatch):
    monkeypatch.setenv("CORS_ALLOWED_ORIGIN", "https://protspace.app, https://staging.protspace.app")
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


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("1", True),
        ("true", True),
        ("True", True),
        ("YES", True),
        ("yes", True),
        ("0", False),
        ("false", False),
        ("no", False),
        ("", False),
        ("  true  ", True),
    ],
)
def test_parse_bool(raw, expected):
    assert _parse_bool(raw) is expected


def test_stats_enabled_defaults_true(monkeypatch):
    monkeypatch.delenv("PREP_STATS", raising=False)
    assert load_settings().stats_enabled is True


def test_log_json_format_defaults_false(monkeypatch):
    monkeypatch.delenv("PREP_LOG_JSON_FORMAT", raising=False)
    assert load_settings().log_json_format is False
