# syntax=docker/dockerfile:1
#
# Build context is the REPO ROOT (not apps/protspace): protspace is a uv
# workspace member that depends on the sibling `protlabel` member, so the image
# needs the workspace root lock + both member sources. Build with:
#   docker build -f apps/protspace/Dockerfile .

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS build

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=0

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        gcc \
        libffi-dev \
        libssl-dev \
        libexpat1 \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Layer 1: external deps only (the `frontend` extra = Dash/gunicorn). Cached until
# the workspace lock or any member's pyproject.toml changes.
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    --mount=type=bind,source=apps/protspace/pyproject.toml,target=apps/protspace/pyproject.toml \
    --mount=type=bind,source=apps/protspace/packages/protlabel/pyproject.toml,target=apps/protspace/packages/protlabel/pyproject.toml \
    uv sync --frozen --no-install-workspace --no-dev --extra frontend --package protspace

# Layer 2: bring in the member sources (protspace + its protlabel dep), install
# them non-editable so the runtime only needs the venv. Bundled assets ship
# inside the wheel (protspace/assets), so no separate asset copy is required.
COPY pyproject.toml uv.lock ./
COPY apps/protspace ./apps/protspace
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-editable --extra frontend --package protspace


FROM python:3.12-slim-bookworm AS runtime

LABEL org.opencontainers.image.source=https://github.com/tsenoner/protspace
LABEL org.opencontainers.image.licenses=MIT

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH" \
    DEFAULT_JSON_FILE_PATH=/app/data/Pla2g2/protspace_files/Pla2g2_customized.json

RUN apt-get update && apt-get install -y --no-install-recommends \
        libexpat1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 appuser

WORKDIR /app

# See <https://hynek.me/articles/docker-signals/>.
STOPSIGNAL SIGINT

# --no-editable installed protspace (+ protlabel) into the venv; only the demo
# data file is copied from the build context.
COPY --from=build --chown=appuser:appuser /app/.venv /app/.venv
COPY --chown=appuser:appuser apps/protspace/data/Pla2g2/protspace_files/Pla2g2_customized.json \
    /app/data/Pla2g2/protspace_files/Pla2g2_customized.json

USER appuser

RUN python -Ic 'import protspace'

EXPOSE 8000
CMD ["gunicorn", "protspace.wsgi:server", "--bind", "0.0.0.0:8000", "--timeout", "120"]
