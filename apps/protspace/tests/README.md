# Testing Guide

## Running Tests

### Run all tests (including slow tests)

```bash
uv run pytest
```

### Skip slow tests (recommended for development)

```bash
uv run pytest -m "not slow"
```

### Run only slow/integration tests

```bash
uv run pytest -m slow
uv run pytest -m integration
```

### Run specific test files

```bash
uv run pytest tests/test_reducers.py
```

## Test Markers

- **`@pytest.mark.slow`**: Tests that take significant time to run (e.g., database downloads, large datasets)
- **`@pytest.mark.integration`**: Tests that require external services (e.g., NCBI taxonomy database, UniProt API)

## Slow Tests

Some tests are marked slow and can be skipped during rapid development — they
download external data or run a real model. List them with:

```bash
uv run pytest tests/ --collect-only -q -m slow
```

## CI/CD

CI runs `uv run pytest -m "not slow" -q` by default, with no path argument —
`testpaths` covers both workspace members, so this collects protspace and
protlabel. Slow/integration tests are skipped in CI to avoid external service
dependencies.
