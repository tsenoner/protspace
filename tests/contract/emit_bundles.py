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
* the cell-grammar decision: the CLI reads the input's
  ``protspace_format_version`` stamp *before* that rename drops it, so the
  annotate output's v2 cells are neither migrated a second time (``%3B`` ->
  ``%253B``) nor refused by the v3 encoder as grammar-unknown.

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
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from protspace.data.annotations.encoding import encode_field, stamp_format_version
from protspace.data.io.bundle import PARQUET_BUNDLE_DELIMITER, create_settings_parquet
from protspace.stats.base import STATS_SCHEMA

# Small enough to eyeball a failure, big enough for a category to have members.
PROTEIN_COUNT = 10

# A dataset large enough that per-row shortcuts (a label dictionary built from
# the first rows, a CSR payload sized from a sample) would show; the positional
# payload is the same as the small variants', so both assert one contract.
LARGE_PROTEIN_COUNT = 6_000

# One 2D and one 3D projection, so the reader's dimension handling is covered.
PROJECTIONS = [("PCA_2", 2), ("PCA_3", 3)]

# The protein whose `length` is null, distinguishing "missing" from 0 and NaN.
NULL_LENGTH_INDEX = 3

# The category on the statistics part's per-category row. Published in the
# manifest so the reader asserts against what was written, not a copy of it.
STATISTICS_CATEGORY = "Hydrolase"


# The coverage variant: one protein each for the three ways annotations and
# projections can disagree. Missing coordinates mean "not drawn", never (0, 0).
# GAP_ID has no PCA_3 row; ANNOTATION_ONLY_ID has no projection row at all, so it
# stays in the file but not in the browser's protein set; PROJECTION_ONLY_ID has
# no annotations row, so the encoder adds one with every annotation missing.
COVERAGE_PROTEIN_COUNT = 6
GAP_ID = "P00002"
ANNOTATION_ONLY_ID = "ANNOTATION_ONLY"
PROJECTION_ONLY_ID = "PROJECTION_ONLY"

# An Arrow BOOLEAN column, one value per annotated protein of the coverage
# variant; the browser has always shown it as 'true'/'false', a null as N/A.
BOOLEAN_VALUES = [True, False, None, True, False, True]


def protein_ids(count: int) -> list[str]:
    return [f"P{i:05d}" for i in range(1, count + 1)]


# A label carrying the reserved hit separator. The producer percent-encodes it,
# so a v2 reader must hand back the literal ';' and a v1 reader must not.
LABEL_WITH_RESERVED_CHAR = "Kinase (EC 2.7.11.1); regulatory subunit"

# A two-hit cell with per-hit scores. A reader that splits on '|' before ';'
# swallows the second hit, which is exactly the bug the grammar exists to avoid.
MULTI_HIT_CELL = f"{encode_field('DomA')}|0.91;{encode_field('DomB')}|0.82"


def build_annotations_table(ids: list[str]) -> pa.Table:
    """Mimic ``protspace annotate`` output: an ``identifier`` column plus annotations.

    The CLI renames ``identifier`` to ``protein_id`` while bundling, so emitting
    the pre-rename name here keeps that rename inside the tested surface. Like
    ``annotate``, the table is stamped as v2 cell grammar; an unstamped one
    would be read as plain v1 text and escaped again.

    The payload is positional and identical at every size: protein 1 carries the
    percent-encoded label and the multi-hit cell, protein 4 carries the null
    length. The large variant therefore asserts exactly the same encoding
    contract as the small one.
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
    length[NULL_LENGTH_INDEX] = None

    return stamp_format_version(
        pa.table(
            {
                "identifier": pa.array(ids, pa.string()),
                "family": pa.array(family, pa.string()),
                "domains": pa.array(domains, pa.string()),
                "length": pa.array(length, pa.float64()),
            }
        )
    )


def build_projection_tables(
    ids: list[str], *, gaps: dict[str, str] | None = None
) -> tuple[pa.Table, pa.Table]:
    """Mimic ``protspace project`` output: one 2D and one 3D projection.

    Column names and types mirror ``base_processor``: ``dimensions`` is int64
    (so it reaches the reader as a BigInt), x/y are float32, and z is a nullable
    double that is null for every row of a 2D projection. ``gaps`` maps a
    projection name to the one protein it does not cover.
    """
    gaps = gaps or {}
    projections = PROJECTIONS

    metadata = pa.table(
        {
            "projection_name": pa.array([name for name, _ in projections], pa.string()),
            "dimensions": pa.array([dims for _, dims in projections], pa.int64()),
            "info_json": pa.array(
                [json.dumps({"n_components": dims}) for _, dims in projections],
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
            if gaps.get(name) == protein_id:
                continue
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
    """A settings payload in the shape the Python producer actually writes.

    This is a FLAT ``{annotation_name: envelope}`` map, not a
    ``{"legendSettings": ..., "exportOptions": ...}`` wrapper. Both
    ``build_cluster_legend_settings`` (stats/carriage.py) and
    ``visualization_state_to_settings`` (data/io/settings_converter.py) return
    the flat form, and ``protspace bundle`` writes it through unchanged --
    ``legendSettings`` appears nowhere in the Python sources.

    That distinction is the whole point of asserting it here: the wrapper shape
    takes ``normalizeBundleSettings``'s ``isNormalizedBundleSettings`` branch,
    while every bundle a real producer writes takes the ``isLegacyBundleSettings``
    branch. Using the wrapper would leave the only branch Python -> TS traffic
    ever reaches untested by the contract.
    """
    return {
        "family": {
            "maxVisibleValues": 10,
            "shapeSize": 24,
            "sortMode": "size-desc",
            "hiddenValues": [],
            "enableDuplicateStackUI": False,
            "selectedPaletteId": "kellys",
            "categories": {
                "Hydrolase": {"zOrder": 0, "color": "#ff0000", "shape": "circle"},
            },
        }
    }


def build_statistics_table() -> pa.Table:
    """A tidy statistics table for the optional fifth part.

    Built by handing ``protspace.stats.base.STATS_SCHEMA`` to ``pa.table`` rather
    than by restating the column list: pyarrow then raises here the moment the
    producer adds or renames a column, which is the drift this file exists to
    catch. A hand-mirrored list cannot -- it silently kept emitting the
    pre-``category`` shape after the producer had moved on.

    The columns used to be invented outright, on the premise that the web reader
    ignores this part entirely -- but the reader now also parses it into rows for
    rendering, and warns when the schema is not one it recognises. A fixture with
    made-up columns would either trip that warning or, worse, silently pass while
    proving nothing about the schema the producer actually writes.

    Three rows, so both shapes the producer emits are covered: the
    whole-annotation aggregates (``category`` NULL, what the ⓘ popover reads) and
    the per-category decomposition (what the legend's score strips read). The
    reader distinguishes the two by exactly that NULL.

    The part is still carried verbatim through a web export; parsing is a
    render-side concern layered on top of that, never a precondition for it.
    """
    return pa.table(
        {
            "space_kind": ["projection", "projection", "projection"],
            "space_name": ["PCA_2", "PCA_3", "PCA_2"],
            "annotation": ["group", "group", "group"],
            "stat_family": [
                "annotation_validity",
                "annotation_validity",
                "annotation_validity",
            ],
            "label_kind": ["annotation", "annotation", "annotation"],
            "metric": ["silhouette", "silhouette", "silhouette"],
            "metric_kind": ["validity", "validity", "validity"],
            "value": [0.91, 0.88, 0.72],
            "category": [None, None, STATISTICS_CATEGORY],
            "extra_json": ['{"seed": 42}', None, None],
        },
        schema=STATS_SCHEMA,
    )


def build_coverage_annotations_table(ids: list[str]) -> pa.Table:
    """The coverage variant's annotations: every projected protein but
    ``PROJECTION_ONLY_ID``, plus ``ANNOTATION_ONLY_ID``, with a BOOLEAN column."""
    annotated = [i for i in ids if i != PROJECTION_ONLY_ID] + [ANNOTATION_ONLY_ID]
    return stamp_format_version(
        pa.table(
            {
                "identifier": pa.array(annotated, pa.string()),
                "family": pa.array([encode_field("Hydrolase")] * len(annotated)),
                "reviewed": pa.array(BOOLEAN_VALUES, pa.bool_()),
            }
        )
    )


def write_legacy_v2_bundle(path: Path, ids: list[str]) -> None:
    """Write the five-part v2 container an older release produced, by hand.

    No current writer emits v2 any more, so this is the stand-in for a file a
    user still has on disk: the same annotations, settings and statistics as
    the v3 variants, and one projection gap, for ``protspace convert`` to
    upgrade. The annotations table is stamped v2 after the ``protein_id``
    rename, exactly as ``protspace bundle`` did.
    """
    annotations = build_annotations_table(ids).rename_columns(
        ["protein_id", "family", "domains", "length"]
    )
    metadata, data = build_projection_tables(ids, gaps={"PCA_3": GAP_ID})
    parts = []
    for table in (stamp_format_version(annotations), metadata, data):
        buffer = pa.BufferOutputStream()
        pq.write_table(table, buffer)
        parts.append(buffer.getvalue().to_pybytes())
    statistics = pa.BufferOutputStream()
    pq.write_table(build_statistics_table(), statistics)
    parts += [
        create_settings_parquet(build_settings()),
        statistics.getvalue().to_pybytes(),
    ]
    path.write_bytes(PARQUET_BUNDLE_DELIMITER.join(parts))


def run_cli(command: str, args: list[str], *, variant: str) -> None:
    """Invoke a ``protspace`` subcommand, surfacing stderr on failure.

    Without this the suite would fail later with an unhelpful missing-file
    error, hiding the actual producer-side traceback.
    """
    result = subprocess.run(
        ["protspace", command, *args],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise SystemExit(
            f"`protspace {command}` failed for variant {variant!r} "
            f"(exit {result.returncode})\n"
            f"--- stdout ---\n{result.stdout}\n"
            f"--- stderr ---\n{result.stderr}"
        )


def write_inputs(
    inputs: Path,
    ids: list[str],
    annotations: pa.Table | None = None,
    gaps: dict[str, str] | None = None,
) -> tuple[Path, Path]:
    """Write the annotate/project stand-in parquets. Returns (annotations, projections dir)."""
    projections_dir = inputs / "projections"
    projections_dir.mkdir(parents=True, exist_ok=True)

    annotations_path = inputs / "annotations.parquet"
    metadata_table, data_table = build_projection_tables(ids, gaps=gaps)
    if annotations is None:
        annotations = build_annotations_table(ids)
    pq.write_table(annotations, annotations_path)
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

    # One input set per distinct protein count, shared by every variant that size.
    inputs_by_count = {
        PROTEIN_COUNT: write_inputs(inputs, protein_ids(PROTEIN_COUNT)),
        LARGE_PROTEIN_COUNT: write_inputs(
            out_dir / "inputs-large", protein_ids(LARGE_PROTEIN_COUNT)
        ),
    }
    coverage_ids = protein_ids(COVERAGE_PROTEIN_COUNT - 1) + [PROJECTION_ONLY_ID]
    inputs_by_count[COVERAGE_PROTEIN_COUNT] = write_inputs(
        out_dir / "inputs-coverage",
        coverage_ids,
        annotations=build_coverage_annotations_table(coverage_ids),
        gaps={"PCA_3": GAP_ID},
    )

    # Every layout the producer can write. `stats_no_settings` is the sneaky one:
    # the producer emits a zero-byte settings slot so the parts keep fixed positions.
    variants: dict[str, tuple[int, list[str]]] = {
        "minimal": (PROTEIN_COUNT, []),
        "with_settings": (PROTEIN_COUNT, ["--settings", str(settings_path)]),
        "with_stats": (
            PROTEIN_COUNT,
            ["--settings", str(settings_path), "-s", str(statistics_path)],
        ),
        "stats_no_settings": (PROTEIN_COUNT, ["-s", str(statistics_path)]),
        # Same layout as `minimal`, at a size where per-row shortcuts would show.
        "large": (LARGE_PROTEIN_COUNT, []),
        # Annotations and projections that disagree, plus a BOOLEAN column.
        "coverage": (COVERAGE_PROTEIN_COUNT, []),
    }

    def emit(item: tuple[str, tuple[int, list[str]]]) -> None:
        variant, (count, extra) = item
        annotations_path, projections_dir = inputs_by_count[count]
        output = out_dir / f"{variant}.parquetbundle"
        run_cli(
            "bundle",
            [
                "-a",
                str(annotations_path),
                "-p",
                str(projections_dir),
                "-o",
                str(output),
                *extra,
            ],
            variant=variant,
        )
        if not output.exists():
            raise SystemExit(
                f"variant {variant!r} reported success but wrote no bundle"
            )

    # The legacy variant runs beside the others: a v2 file written the way an older
    # release did, then upgraded by `protspace convert`. Reading both lets the
    # consumer check the converted file means what the legacy one did.
    def convert_legacy() -> None:
        legacy = out_dir / "legacy_v2.parquetbundle"
        write_legacy_v2_bundle(legacy, protein_ids(PROTEIN_COUNT))
        run_cli(
            "convert",
            [str(legacy), str(out_dir / "converted.parquetbundle")],
            variant="converted",
        )

    # Each `protspace` call costs ~0.33s, of which ~0.26s is interpreter +
    # typer/rich/pyarrow import startup and only ~0.07s is real work (measured;
    # unchanged from 10 to 20_000 proteins). Running the calls sequentially pays
    # that startup once per call. The variants share read-only inputs, write
    # disjoint outputs, and `_atomic_write_bytes` stages through
    # `tempfile.mkstemp`, so there is no ordering or collision hazard.
    #
    # Threads rather than processes: every call is a `subprocess.run`, so the GIL
    # is released for the whole wait and the fan-out is bounded by runner cores,
    # not by Python. Draining the map iterator re-raises whatever a worker raised,
    # including the SystemExit from `run_cli`.
    with ThreadPoolExecutor(max_workers=len(variants) + 1) as pool:
        legacy = pool.submit(convert_legacy)
        list(pool.map(emit, variants.items()))
        legacy.result()

    # The consumer reads its expectations from here rather than restating them.
    # A hand-mirrored constant fails in the reader when the generator is what
    # changed, pointing the reader at the wrong half of the seam.
    (out_dir / "manifest.json").write_text(
        json.dumps(
            {
                "proteinCount": PROTEIN_COUNT,
                "largeProteinCount": LARGE_PROTEIN_COUNT,
                "projectionCount": len(PROJECTIONS),
                "labelWithReservedChar": LABEL_WITH_RESERVED_CHAR,
                "nullLengthIndex": NULL_LENGTH_INDEX,
                "statisticsColumns": STATS_SCHEMA.names,
                "statisticsCategory": STATISTICS_CATEGORY,
                "gapId": GAP_ID,
                "annotationOnlyId": ANNOTATION_ONLY_ID,
                "projectionOnlyId": PROJECTION_ONLY_ID,
                "booleanById": dict(
                    zip(
                        build_coverage_annotations_table(coverage_ids)
                        .column("identifier")
                        .to_pylist(),
                        BOOLEAN_VALUES,
                        strict=True,
                    )
                ),
            }
        ),
        encoding="utf-8",
    )

    print(f"wrote {len(variants) + 2} bundles to {out_dir}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: emit_bundles.py <output-dir>")
    main(Path(sys.argv[1]))
