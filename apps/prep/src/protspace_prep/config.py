from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class Settings:
    job_root: Path
    max_concurrent_jobs: int
    max_pending_jobs: int
    # Retention. See `retention_worst_case_seconds` and the bound below.
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

    @property
    def retention_worst_case_seconds(self) -> int:
        """Longest an upload and its bundle can exist on disk, measured from upload.

        Three settings stack up. A job is deleted once its directory is older
        than the TTL, but the sweeper only runs every `sweep_interval_seconds`,
        so becoming eligible is not the same as being removed. And the
        directory's mtime tracks the last pipeline write rather than the
        upload, so the clock effectively starts up to a full
        `pipeline_timeout_seconds` late.
        """
        return (
            self.pipeline_timeout_seconds
            + self.bundle_ttl_seconds
            + self.sweep_interval_seconds
        )


# The retention bound published to users, in `apps/web/src/pages/Privacy.tsx`
# ("Your Data": deleted "in any case within two hours").
#
# This is a promise, not a readout: the page states a figure a human chose, and
# this constant is what holds the configuration to it. `load_settings` refuses
# to start the service when the configured worst case exceeds it, so a TTL
# raised here or via PREP_* in deploy-protspace-backend cannot silently make a
# published privacy commitment false. Going under it is fine — the page is then
# merely conservative.
#
# To change the promise, edit the page and this constant together.
PUBLISHED_RETENTION_BOUND_SECONDS = 7200


def _parse_origins(raw: str) -> tuple[str, ...]:
    return tuple(o.strip() for o in raw.split(",") if o.strip())


def load_settings() -> Settings:
    settings = Settings(
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

    # Fail fast rather than serve while contradicting the published policy: a
    # service that is down is a visible problem someone fixes, whereas one that
    # quietly retains uploads for longer than users were told is not.
    worst_case = settings.retention_worst_case_seconds
    if worst_case > PUBLISHED_RETENTION_BOUND_SECONDS:
        raise ValueError(
            f"Retention worst case is {worst_case}s "
            f"(PREP_PIPELINE_TIMEOUT_SECONDS={settings.pipeline_timeout_seconds} "
            f"+ PREP_BUNDLE_TTL_SECONDS={settings.bundle_ttl_seconds} "
            f"+ PREP_SWEEP_INTERVAL_SECONDS={settings.sweep_interval_seconds}), "
            f"which exceeds the {PUBLISHED_RETENTION_BOUND_SECONDS}s bound "
            "published in apps/web/src/pages/Privacy.tsx. Lower one of those "
            "settings, or change the published promise and "
            "PUBLISHED_RETENTION_BOUND_SECONDS together."
        )

    return settings
