"""Generate the canonical .parquetbundle files for the cross-language contract test.

The producer (``apps/protspace``, Python) and the consumer (``packages/core``
data-loader, TypeScript) live in one repo but are tested only against
themselves. This script is the producer half of the seam: it emits every bundle
layout the producer can write, and ``bundle.contract.test.ts`` reads them back
with the real web reader.

Bundles are always generated into a caller-supplied directory, never committed.
A committed fixture cannot fail when the writer changes; a generated one can.

The bundles are produced by shelling out to the real ``protspace bundle`` CLI
rather than by calling ``write_bundle`` directly. Two transformations live only
in the CLI layer and are contract surface the reader depends on:

* the ``identifier`` -> ``protein_id`` column rename, and
* ``stamp_format_version``, which marks the annotations table as v2.

A reader that mishandles either still passes a ``write_bundle``-only generator.

ASSUMPTION THIS FILE ENCODES
----------------------------
The input parquets below stand in for what ``protspace annotate`` and
``protspace project`` would have produced -- their schemas are hand-written here
from the real thing (see ``base_processor._create_projections_*_table`` and the
``annotate`` CLI). If those stages change their output columns, this generator
keeps emitting the old shape and the contract test stays green against a stale
idea of their output. That narrower gap is a documented non-goal of the
``add-bundle-contract-test`` change; the gap being closed is the much wider one
where nothing checked the producer/consumer seam at all.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from protspace.data.annotations.encoding import encode_field

# Small enough to eyeball a failure, big enough for a category to have members.
PROTEIN_COUNT = 10

# The reader routes datasets of 10_000+ projection rows through a separate,
# optimized conversion implementation (see `convertParquetToVisualizationData
# Optimized` in conversion.ts) -- the one every production dataset actually
# takes. 6_000 proteins x 2 projections = 12_000 rows clears that threshold, so
# the contract covers both implementations rather than only the small-data one.
LARGE_PROTEIN_COUNT = 6_000


def protein_ids(count: int) -> list[str]:
    return [f"P{i:05d}" for i in range(1, count + 1)]


# A label carrying the reserved hit separator. The producer percent-encodes it,
# so a v2 reader must hand back the literal ';' and a v1 reader must not.
LABEL_WITH_RESERVED_CHAR = "Kinase (EC 2.7.11.1); regulatory subunit"

# A two-hit cell with per-hit scores. A reader that splits on '|' before ';'
# swallows the second hit, which is exactly the bug the grammar exists to avoid.
MULTI_HIT_CELL = f"{encode_field('DomA')}|0.91;{encode_field('DomB')}|0.82"

# Larger than 2^53, so it survives the JSON round-trip only if nothing coerces
# it through a float. info_json reaches the reader as an opaque string.
LARGE_INT_IN_INFO_JSON = 9007199254740993


def build_annotations_table(ids: list[str]) -> pa.Table:
    """Mimic ``protspace annotate`` output: an ``identifier`` column plus annotations.

    The CLI renames ``identifier`` to ``protein_id`` while bundling, so emitting
    the pre-rename name here keeps that rename inside the tested surface.

    The payload is positional and identical at every size: protein 1 carries the
    percent-encoded label and the multi-hit cell, protein 4 carries the null
    length. The large variant therefore asserts exactly the same encoding
    contract as the small one, just through the optimized reader path.
    """
    rest = len(ids) - 1
    family = [encode_field(LABEL_WITH_RESERVED_CHAR)] + [
        encode_field("Hydrolase")
    ] * rest
    domains = [MULTI_HIT_CELL] + [f"{encode_field('DomB')}|0.75"] * rest

    # A genuine double column with a null -- distinguishes "missing" from 0 and
    # from NaN across the language boundary. Real bundles carry both string-typed
    # and double-typed numeric annotations; the double form is the stricter case.
    length = [float(100 + i * 10) for i in range(len(ids))]
    length[3] = None

    return pa.table(
        {
            "identifier": pa.array(ids, pa.string()),
            "family": pa.array(family, pa.string()),
            "domains": pa.array(domains, pa.string()),
            "length": pa.array(length, pa.float64()),
        }
    )


def build_projection_tables(ids: list[str]) -> tuple[pa.Table, pa.Table]:
    """Mimic ``protspace project`` output: one 2D and one 3D projection.

    Column names and types mirror ``base_processor``: ``dimensions`` is int64
    (so it reaches the reader as a BigInt), x/y are float32, and z is a nullable
    double that is null for every row of a 2D projection.
    """
    projections = [("PCA_2", 2), ("PCA_3", 3)]

    metadata = pa.table(
        {
            "projection_name": pa.array([name for name, _ in projections], pa.string()),
            "dimensions": pa.array([dims for _, dims in projections], pa.int64()),
            "info_json": pa.array(
                [
                    json.dumps(
                        {"n_components": dims, "fitted_on": LARGE_INT_IN_INFO_JSON}
                    )
                    for _, dims in projections
                ],
                pa.string(),
            ),
            "source": pa.array(["contract_embedding"] * len(projections), pa.string()),
        }
    )

    names: list[str] = []
    identifiers: list[str] = []
    xs: list[float] = []
    ys: list[float] = []
    zs: list[float | None] = []
    for name, dims in projections:
        for i, protein_id in enumerate(ids):
            names.append(name)
            identifiers.append(protein_id)
            xs.append(float(i))
            ys.append(float(i) * 2.0)
            zs.append(float(i) * 3.0 if dims == 3 else None)

    data = pa.table(
        {
            "projection_name": pa.array(names, pa.string()),
            "identifier": pa.array(identifiers, pa.string()),
            "x": pa.array(xs, pa.float32()),
            "y": pa.array(ys, pa.float32()),
            "z": pa.array(zs, pa.float64()),
        }
    )
    return metadata, data


def build_settings() -> dict:
    """A settings payload that survives the reader's ``normalizeBundleSettings``.

    Shaped to the normalized (non-legacy) branch so the test asserts a real
    round-trip rather than the null-on-reject fallback.
    """
    return {
        "legendSettings": {
            "family": {
                "maxVisibleValues": 10,
                "shapeSize": 24,
                "sortMode": "size-desc",
                "hiddenValues": [],
                "enableDuplicateStackUI": False,
                "categories": {
                    "Hydrolase": {"zOrder": 0, "color": "#ff0000", "shape": "circle"},
                },
            }
        },
        "exportOptions": {},
    }


def build_statistics_table() -> pa.Table:
    """A plausible tidy statistics table for the optional fifth part.

    The web reader must ignore this part entirely, so only its presence and
    validity as parquet matter -- not its columns.
    """
    return pa.table(
        {
            "projection_name": pa.array(["PCA_2", "PCA_3"], pa.string()),
            "metric": pa.array(["trustworthiness", "trustworthiness"], pa.string()),
            "value": pa.array([0.91, 0.88], pa.float64()),
        }
    )


def run_bundle(args: list[str], *, variant: str) -> None:
    """Invoke ``protspace bundle``, surfacing stderr on failure.

    Without this the suite would fail later with an unhelpful missing-file
    error, hiding the actual producer-side traceback.
    """
    result = subprocess.run(
        ["protspace", "bundle", *args],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise SystemExit(
            f"`protspace bundle` failed for variant {variant!r} "
            f"(exit {result.returncode})\n"
            f"--- stdout ---\n{result.stdout}\n"
            f"--- stderr ---\n{result.stderr}"
        )


def write_inputs(inputs: Path, ids: list[str]) -> tuple[Path, Path]:
    """Write the annotate/project stand-in parquets. Returns (annotations, projections dir)."""
    projections_dir = inputs / "projections"
    projections_dir.mkdir(parents=True, exist_ok=True)

    annotations_path = inputs / "annotations.parquet"
    metadata_table, data_table = build_projection_tables(ids)
    pq.write_table(build_annotations_table(ids), annotations_path)
    pq.write_table(metadata_table, projections_dir / "projections_metadata.parquet")
    pq.write_table(data_table, projections_dir / "projections_data.parquet")

    return annotations_path, projections_dir


def main(out_dir: Path) -> None:
    inputs = out_dir / "inputs"
    inputs.mkdir(parents=True, exist_ok=True)

    settings_path = inputs / "settings.json"
    statistics_path = inputs / "statistics.parquet"
    pq.write_table(build_statistics_table(), statistics_path)
    settings_path.write_text(json.dumps(build_settings()), encoding="utf-8")

    annotations_path, projections_dir = write_inputs(inputs, protein_ids(PROTEIN_COUNT))
    common = ["-a", str(annotations_path), "-p", str(projections_dir)]

    # Every layout the producer can write. `stats_no_settings` is the sneaky one:
    # the producer emits a zero-byte settings slot to keep statistics at part five.
    variants: dict[str, list[str]] = {
        "minimal": [],
        "with_settings": ["--settings", str(settings_path)],
        "with_stats": ["--settings", str(settings_path), "-s", str(statistics_path)],
        "stats_no_settings": ["-s", str(statistics_path)],
    }

    for variant, extra in variants.items():
        output = out_dir / f"{variant}.parquetbundle"
        run_bundle([*common, "-o", str(output), *extra], variant=variant)
        if not output.exists():
            raise SystemExit(
                f"variant {variant!r} reported success but wrote no bundle"
            )

    # Same layout as `minimal`, sized past the reader's optimized-path threshold.
    large_inputs = out_dir / "inputs-large"
    large_inputs.mkdir(parents=True, exist_ok=True)
    large_annotations, large_projections = write_inputs(
        large_inputs, protein_ids(LARGE_PROTEIN_COUNT)
    )
    large_output = out_dir / "large.parquetbundle"
    run_bundle(
        [
            "-a",
            str(large_annotations),
            "-p",
            str(large_projections),
            "-o",
            str(large_output),
        ],
        variant="large",
    )
    if not large_output.exists():
        raise SystemExit("variant 'large' reported success but wrote no bundle")

    print(f"wrote {len(variants) + 1} bundles to {out_dir}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: emit_bundles.py <output-dir>")
    main(Path(sys.argv[1]))
