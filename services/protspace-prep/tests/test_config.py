from protspace_prep.config import load_settings


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
