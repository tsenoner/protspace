# Testing Guide

## Running Tests

### Run all tests (including slow tests)

```bash
uvrun pytest
```

### Skip slow tests (recommended for development)

```bash
uvrun pytest -m "not slow"
```

### Run only slow/integration tests

```bash
uvrun pytest -m slow
uvrun pytest -m integration
```

### Run specific test files

```bash
uvrun pytest tests/test_config.py
```

## Test Markers

- **`@pytest.mark.slow`**: Tests that take significant time to run (e.g., database downloads, large datasets)
- **`@pytest.mark.integration`**: Tests that require external services (e.g., NCBI taxonomy database, UniProt API)

## Slow Tests

The following tests are marked as slow and can be skipped during rapid development:

- `tests/test_taxonomy_feature_retriever.py` - Downloads and uses NCBI taxonomy database (~several seconds per test run)

## CI/CD

In CI pipelines, always run the full test suite including slow tests to ensure complete coverage.
