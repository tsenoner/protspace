# syntax=docker/dockerfile:1
#
# Build context is the REPO ROOT (not apps/prep): protspace-prep is a uv workspace
# member source-pinned to the sibling `protspace` member, so the image needs the
# workspace root lock + both member sources. Build with:
#   docker build -f apps/prep/Dockerfile .

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim@sha256:e5b65587bce7de595f299855d7385fe7fca39b8a74baa261ba1b7147afa78e58 AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=0

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Layer 1: external deps only (no workspace members). Cached until the workspace
# lock or any member's pyproject.toml changes.
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    --mount=type=bind,source=apps/prep/pyproject.toml,target=apps/prep/pyproject.toml \
    --mount=type=bind,source=apps/protspace/pyproject.toml,target=apps/protspace/pyproject.toml \
    uv sync --frozen --no-install-workspace --no-dev --package protspace-prep

# Layer 2: bring in the member sources prep needs (prep + its editable protspace
# dep), install them non-editable so the runtime only needs the venv.
COPY pyproject.toml uv.lock ./
COPY apps/protspace ./apps/protspace
COPY apps/prep ./apps/prep
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-editable --package protspace-prep


FROM python:3.12-slim-bookworm@sha256:93ab4b7fa528b25124c97bcc755415e60eb671a86b4dbe0328df2fe2d1c1193d AS runtime

LABEL org.opencontainers.image.source=https://github.com/tsenoner/protspace
LABEL org.opencontainers.image.licenses=MIT

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PREP_JOB_ROOT=/var/lib/protspace-prep/jobs \
    PATH="/app/.venv/bin:$PATH"

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 appuser \
    && mkdir -p /var/lib/protspace-prep/jobs \
    && chown -R appuser:appuser /var/lib/protspace-prep

WORKDIR /app

# --no-editable installs protspace-prep (and protspace) into the venv, so no source copy needed.
COPY --from=builder --chown=appuser:appuser /app/.venv /app/.venv

USER appuser

EXPOSE 8000

CMD ["uvicorn", "protspace_prep.app:app", "--host", "0.0.0.0", "--port", "8000"]
