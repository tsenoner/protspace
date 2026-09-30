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
# the first rows, a CSR payload sized from a sample) would show, and past the
# 20,000 rows pyarrow puts in one data page, so the reader copies several chunks
# per column at a non-zero row offset, as it does at production scale. The payload
# follows the same per-row rule as the small variants', so both assert one
# contract, and the large one is checked row by row (``largeExpected``).
LARGE_PROTEIN_COUNT = 45_000

# Coordinates are ``i * scale`` per axis for protein ``i``, so every row of every
# projection is checkable from its index alone.
AXIS_SCALE = (1.0, 2.0, 3.0)

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
# The family only ANNOTATION_ONLY_ID carries: the browser must not list it.
ANNOTATION_ONLY_FAMILY = "Unplaced family"
PROJECTION_ONLY_ID = "PROJECTION_ONLY"

# An Arrow BOOLEAN column, one value per annotated protein of the coverage
# variant; the browser has always shown it as 'true'/'false', a null as N/A.
BOOLEAN_VALUES = [True, False, None, True, False, True]

# Two int64 columns the web writer must hand back as int64: a 64-bit hash past
# float64's exact range, which Python stores as exact decimal labels, and the
# ±2**53 edge, which it still stores as numbers.
HASH_VALUES = [2**60 + 1, 5, None, 2**62, -(2**61), 7]
EDGE_VALUES = [2**53, 1, None, -(2**53), 2, 3]


def protein_ids(count: int) -> list[str]:
    return [f"P{i:05d}" for i in range(1, count + 1)]


# A label carrying the reserved hit separator. The producer percent-encodes it,
# so a v2 reader must hand back the literal ';' and a v1 reader must not.
LABEL_WITH_RESERVED_CHAR = "Kinase (EC 2.7.11.1); regulatory subunit"

# A two-hit cell with per-hit scores. A reader that splits on '|' before ';'
# swallows the second hit, which is exactly the bug the grammar exists to avoid.
MULTI_HIT_HITS = [("DomA", 0.91), ("DomB", 0.82)]
MULTI_HIT_CELL = ";".join(
    f"{encode_field(label)}|{score}" for label, score in MULTI_HIT_HITS
)

# Every this-many rows the reserved-character label recurs, so it is also decoded
# far past the first page.
RESERVED_LABEL_PERIOD = 10_007


def family_label(index: int) -> str:
    """The decoded ``family`` label of protein ``index`` (row 0: the reserved one)."""
    if index % RESERVED_LABEL_PERIOD == 0:
        return LABEL_WITH_RESERVED_CHAR
    return f"Family {index % 37}"


def domain_hits(index: int) -> list[tuple[str, float]]:
    """The decoded ``domains`` hits of protein ``index``: one to three, scored."""
    if index == 0:
        return MULTI_HIT_HITS
    return [
        (f"Dom{(index + k) % 11}", ((index * 7 + k) % 100) / 100)
        for k in range(1 + index % 3)
    ]


def length_value(index: int) -> float | None:
    return None if index == NULL_LENGTH_INDEX else float(100 + index * 10)


def build_annotations_table(ids: list[str]) -> pa.Table:
    """Mimic ``protspace annotate`` output: an ``identifier`` column plus annotations.

    The CLI renames ``identifier`` to ``protein_id`` while bundling, so emitting
    the pre-rename name here keeps that rename inside the tested surface. Like
    ``annotate``, the table is stamped as v2 cell grammar; an unstamped one
    would be read as plain v1 text and escaped again.

    Every cell follows one per-row rule at every size (``family_label``,
    ``domain_hits``, ``length_value``): protein 1 carries the percent-encoded
    label and the multi-hit cell, protein 4 the null length, and every other row
    its own labels, hit count and scores. The large variant therefore asserts
    the same encoding contract as the small one, and can be checked row by row.
    """
    family = [encode_field(family_label(i)) for i in range(len(ids))]
    domains = [
        ";".join(f"{encode_field(label)}|{score}" for label, score in domain_hits(i))
        for i in range(len(ids))
    ]

    # A genuine double column with a null -- distinguishes "missing" from 0 and
    # from NaN across the language boundary. Real bundles carry both string-typed
    # and double-typed numeric annotations; the double form is the stricter case.
    length = [length_value(i) for i in range(len(ids))]

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
            xs.append(float(i) * AXIS_SCALE[0])
            ys.append(float(i) * AXIS_SCALE[1])
            zs.append(float(i) * AXIS_SCALE[2] if dims == 3 else None)

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
    ``PROJECTION_ONLY_ID``, plus ``ANNOTATION_ONLY_ID``, with a BOOLEAN column
    and the two int64 columns a web re-export must keep int64.

    The ids are in ``protein_id`` and ``identifier`` is an ordinary annotation:
    ``bundle -a`` renames ``identifier`` only when ``protein_id`` is absent, so
    the web writer must name its id column around that annotation."""
    annotated = [i for i in ids if i != PROJECTION_ONLY_ID] + [ANNOTATION_ONLY_ID]
    return stamp_format_version(
        pa.table(
            {
                "protein_id": pa.array(annotated, pa.string()),
                "identifier": pa.array([f"alias-{i}" for i in annotated]),
                "family": pa.array(
                    [
                        encode_field(
                            ANNOTATION_ONLY_FAMILY
                            if i == ANNOTATION_ONLY_ID
                            else "Hydrolase"
                        )
                        for i in annotated
                    ]
                ),
                "reviewed": pa.array(BOOLEAN_VALUES, pa.bool_()),
                "hash": pa.array(HASH_VALUES, pa.int64()),
                "edge": pa.array(EDGE_VALUES, pa.int64()),
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

    It also holds an annotation-only protein, which no projection places, whose
    ``size`` is ``unknown`` among the placed proteins' numbers: v2 showed
    ``size`` as numeric, since it inferred over the placed proteins, and the
    converted bundle has to as well, with the same dataset hash.
    """
    annotations = build_annotations_table(ids).rename_columns(
        ["protein_id", "family", "domains", "length"]
    )
    annotations = annotations.append_column(
        "size", pa.array([str(10 * i) if i % 3 else "NA" for i in range(len(ids))])
    )
    unplaced = pa.table(
        {
            "protein_id": ["UNPLACED"],
            "family": [""],
            "domains": [""],
            "length": pa.array([None], pa.float64()),
            "size": ["unknown"],
        }
    )
    annotations = pa.concat_tables([annotations, unplaced])
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
                "axisScale": AXIS_SCALE,
                # What the large bundle decodes to, row by row, so a reader that
                # mishandles a payload only past its first rows or pages fails.
                "largeExpected": {
                    "family": [family_label(i) for i in range(LARGE_PROTEIN_COUNT)],
                    "domains": [
                        [label for label, _ in domain_hits(i)]
                        for i in range(LARGE_PROTEIN_COUNT)
                    ],
                    "domainScores": [
                        [score for _, score in domain_hits(i)]
                        for i in range(LARGE_PROTEIN_COUNT)
                    ],
                    "length": [length_value(i) for i in range(LARGE_PROTEIN_COUNT)],
                },
                "projectionCount": len(PROJECTIONS),
                "labelWithReservedChar": LABEL_WITH_RESERVED_CHAR,
                "nullLengthIndex": NULL_LENGTH_INDEX,
                "statisticsColumns": STATS_SCHEMA.names,
                "statisticsCategory": STATISTICS_CATEGORY,
                "gapId": GAP_ID,
                "annotationOnlyId": ANNOTATION_ONLY_ID,
                "annotationOnlyFamily": ANNOTATION_ONLY_FAMILY,
                "projectionOnlyId": PROJECTION_ONLY_ID,
                "booleanById": dict(
                    zip(
                        build_coverage_annotations_table(coverage_ids)
                        .column("protein_id")
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
