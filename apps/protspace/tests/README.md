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

The following tests are marked as slow and can be skipped during rapid development:

- `tests/test_taxonomy_annotation_retriever.py` - Downloads and uses NCBI taxonomy database (~several seconds per test run)

## CI/CD

CI runs `uv run pytest tests/ -m "not slow" -q` by default. Slow/integration tests are skipped in CI to avoid external service dependencies.
