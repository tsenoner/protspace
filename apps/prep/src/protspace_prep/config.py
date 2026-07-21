from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class Settings:
    job_root: Path
    max_concurrent_jobs: int
    max_pending_jobs: int
    bundle_ttl_seconds: int
    upload_max_bytes: int
    sequence_max_count: int
    sequence_max_residues: int
    sequence_max_total_residues: int
    sequence_min_count: int
    embedder: str
    methods: str
    annotations: str
    sweep_interval_seconds: int
    pipeline_timeout_seconds: int
    log_level: str
    log_json_format: bool
    cors_allowed_origins: tuple[str, ...]
    rate_limit: str


def _parse_origins(raw: str) -> tuple[str, ...]:
    return tuple(o.strip() for o in raw.split(",") if o.strip())


def load_settings() -> Settings:
    return Settings(
        job_root=Path(os.getenv("PREP_JOB_ROOT", "/var/lib/protspace-prep/jobs")),
        max_concurrent_jobs=int(os.getenv("PREP_MAX_CONCURRENT_JOBS", "5")),
        max_pending_jobs=int(os.getenv("PREP_MAX_PENDING_JOBS", "50")),
        bundle_ttl_seconds=int(os.getenv("PREP_BUNDLE_TTL_SECONDS", "3600")),
        upload_max_bytes=int(os.getenv("PREP_UPLOAD_MAX_BYTES", str(8 * 1024 * 1024))),
        sequence_max_count=int(os.getenv("PREP_SEQUENCE_MAX_COUNT", "1500")),
        sequence_max_residues=int(os.getenv("PREP_SEQUENCE_MAX_RESIDUES", "2000")),
        sequence_max_total_residues=int(
            os.getenv("PREP_SEQUENCE_MAX_TOTAL_RESIDUES", str(1_500_000))
        ),
        sequence_min_count=int(os.getenv("PREP_SEQUENCE_MIN_COUNT", "20")),
        embedder=os.getenv("PREP_EMBEDDER", "prot_t5"),
        methods=os.getenv("PREP_METHODS", "pca2,umap2"),
        annotations=os.getenv("PREP_ANNOTATIONS", "default"),
        sweep_interval_seconds=int(os.getenv("PREP_SWEEP_INTERVAL_SECONDS", "300")),
        pipeline_timeout_seconds=int(os.getenv("PREP_PIPELINE_TIMEOUT_SECONDS", "420")),
        log_level=os.getenv("PREP_LOG_LEVEL", "INFO"),
        log_json_format=(
            os.getenv("PREP_LOG_JSON_FORMAT", "false").lower() in {"1", "true", "yes"}
        ),
        cors_allowed_origins=_parse_origins(os.getenv("CORS_ALLOWED_ORIGIN", "")),
        rate_limit=(os.getenv("PREP_RATE_LIMIT", "").strip() or "5/15minutes"),
    )
