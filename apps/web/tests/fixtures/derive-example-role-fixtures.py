# /// script
# requires-python = ">=3.10"
# dependencies = ["pyarrow==25.0.0"]
# ///
"""Derive the E2E suite's example role fixtures from the pinned fixtures.

The E2E suite routes every catalog example it loads to a small fixture
(`apps/web/tests/helpers/example-fixtures.ts`) that must hold the example's
curated `defaultView` names, or the example opens with a drift warning and the
scenario fails. The suite names examples by the part they play:

    role   example id           fixture                  derived from
    small  human-fly            example_role_small_5181  toxprot_5181_pca3d
    other  beta-lactamase       example_role_other_1587  phosphatase_1587
    slow   swissprot            example_role_slow_40026  pe1_40026_pca3d
    eat    three-finger-toxins  example_role_eat_811     venom_eat_stats_811

Each keeps its pinned fixture's proteins, its coordinates and the columns the
scenarios name, and adds the example's view names. The projection name
(`ProtT5 — UMAP 2`) is a copy of an existing layout, and the added columns are
synthetic: the suite tests the app's example mechanics, not what the
examples hold. The eat fixture relabels the venom fixture's transferred EC
numbers as three-finger toxin classes, holds every eighth reference out as
`toxin_class_withheld`, and stores an EAT reliability threshold of 0.5 in its
settings, so a scenario can tell the bundled threshold from the default 0.

Run from the repository root; `--check` fails if a committed fixture differs
from what this script writes (pyarrow is pinned, so the bytes are stable):

    uv run apps/web/tests/fixtures/derive-example-role-fixtures.py [--check]
"""

from __future__ import annotations

import argparse
import io
import json
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

FIXTURES = Path(__file__).resolve().parent
DELIMITER = b"---PARQUET_DELIMITER---"
FINAL_UMAP = "ProtT5 — UMAP 2"


def read_parts(name: str) -> list[bytes]:
    """A pinned fixture's parts, read as tables below.

    The pinned fixtures are legacy (v1/v2) containers, whose parts are plain
    tables. A v3 container (six parts) stores encoded columns instead, so it is
    refused here rather than misread: derive from the legacy bytes (the v3
    copies are separate `*_v3` fixtures).
    """
    parts = (FIXTURES / name).read_bytes().split(DELIMITER)
    if not 3 <= len(parts) <= 5:
        raise SystemExit(
            f"{name} has {len(parts)} parts, not a legacy (v1/v2) bundle's 3 to 5; "
            "this script derives the role fixtures from the legacy fixtures"
        )
    return parts


def read_table(part: bytes) -> pa.Table:
    return pq.read_table(io.BytesIO(part))


def without_pandas_metadata(table: pa.Table) -> pa.Table:
    """Drop the pandas schema metadata, which would go stale; keep the rest."""
    metadata = {
        k: v for k, v in (table.schema.metadata or {}).items() if k != b"pandas"
    }
    return table.replace_schema_metadata(metadata or None)


def to_parquet(table: pa.Table) -> bytes:
    buffer = io.BytesIO()
    pq.write_table(without_pandas_metadata(table), buffer)
    blob = buffer.getvalue()
    if DELIMITER in blob:
        raise SystemExit("a serialized part contains the bundle delimiter")
    return blob


def with_final_umap(
    metadata: pa.Table, data: pa.Table, source: str, keep: list[str]
) -> tuple[pa.Table, pa.Table]:
    """Copy projection `source` as `ProtT5 — UMAP 2` (listed first); keep only `keep`."""
    names = metadata.column("projection_name").to_pylist()
    copy = metadata.slice(names.index(source), 1)
    copy = copy.set_column(
        copy.schema.get_field_index("projection_name"),
        "projection_name",
        pa.array([FINAL_UMAP], pa.string()),
    )
    kept = metadata.filter(pc.is_in(metadata.column("projection_name"), pa.array(keep)))
    new_metadata = pa.concat_tables([copy, kept])

    rows = data.filter(pc.equal(data.column("projection_name"), source))
    rows = rows.set_column(
        rows.schema.get_field_index("projection_name"),
        "projection_name",
        pa.array([FINAL_UMAP] * rows.num_rows, pa.string()),
    )
    kept_rows = data.filter(pc.is_in(data.column("projection_name"), pa.array(keep)))
    return new_metadata, pa.concat_tables([rows, kept_rows])


def cycle(values: list[str], n: int, *, every: int = 1) -> pa.Array:
    """A deterministic column: value `(i // every) % len(values)` for row i."""
    return pa.array([values[(i // every) % len(values)] for i in range(n)], pa.string())


FAMILIES = [
    "protein kinase superfamily",
    "G-protein coupled receptor 1 family",
    "small GTPase superfamily",
    "cytochrome P450 family",
    "insect odorant-binding protein family",
    "MHC class I family",
]


def small() -> bytes:
    """The 5,181 proteins + species, protein_families and reviewed; PCA_2 also as `ProtT5 — UMAP 2`."""
    annotations, metadata, data = (
        read_table(p) for p in read_parts("toxprot_5181_pca3d.parquetbundle")
    )
    n = annotations.num_rows
    annotations = (
        annotations.append_column(
            "species", cycle(["Homo sapiens"] * 4 + ["Drosophila melanogaster"], n)
        )
        .append_column("protein_families", cycle(FAMILIES, n, every=7))
        .append_column("reviewed", cycle(["Swiss-Prot", "TrEMBL", "TrEMBL"], n))
    )
    metadata, data = with_final_umap(metadata, data, "PCA_2", ["PCA_2"])
    return DELIMITER.join(to_parquet(t) for t in (annotations, metadata, data))


def other() -> bytes:
    """Phosphatases, whose ESM2 UMAP is also `ProtT5 — UMAP 2`; the columns are unchanged."""
    annotations, metadata, data = (
        read_table(p) for p in read_parts("phosphatase_1587.parquetbundle")
    )
    metadata, data = with_final_umap(
        metadata, data, "ESM2-650M — UMAP 2", ["ESM2-650M — UMAP 2"]
    )
    return DELIMITER.join(to_parquet(t) for t in (annotations, metadata, data))


def slow() -> bytes:
    """The 40,026 proteins + domain, protein_families and species (and still no phylum); PCA_2 also as `ProtT5 — UMAP 2`."""
    annotations, metadata, data = (
        read_table(p) for p in read_parts("pe1_40026_pca3d.parquetbundle")
    )
    n = annotations.num_rows
    domains = ["Bacteria"] * 6 + ["Eukaryota"] * 3 + ["Archaea"]
    species = [
        "Escherichia coli",
        "Bacillus subtilis",
        "Homo sapiens",
        "Saccharomyces cerevisiae",
    ]
    annotations = (
        annotations.append_column("domain", cycle(domains, n))
        .append_column("protein_families", cycle(FAMILIES, n, every=11))
        .append_column("species", cycle(species, n, every=3))
    )
    metadata, data = with_final_umap(metadata, data, "PCA_2", ["PCA_2"])
    return DELIMITER.join(to_parquet(t) for t in (annotations, metadata, data))


TOXIN_CLASSES = [
    "Type I α-neurotoxin",
    "Type II α-neurotoxin",
    "Type III α-neurotoxin",
    "cytotoxin",
    "aminergic toxin",
    "κ-neurotoxin",
    "other short-chain toxin",
    "ancestral toxin",
]


def eat() -> bytes:
    """Venom EAT + toxin_class with its EAT companions, a hold-out and a bundled threshold of 0.5."""
    parts = read_parts("venom_eat_stats_811.parquetbundle")
    annotations = read_table(parts[0])
    ids = annotations.column("protein_id").to_pylist()
    curated = annotations.column("ec").to_pylist()
    predicted = annotations.column("ec__pred_value").to_pylist()
    confidence = annotations.column("ec__pred_confidence").to_pylist()
    source = annotations.column("ec__pred_source").to_pylist()

    def label(cell: str | None) -> str:
        return (cell or "").split("|")[0]

    ecs = sorted({label(c) for c in curated + predicted} - {""})

    def to_class(cell: str | None) -> str:
        """The toxin class an EC number stands for; each EC keeps one class."""
        return (
            TOXIN_CLASSES[ecs.index(label(cell)) % len(TOXIN_CLASSES)]
            if label(cell)
            else ""
        )

    toxin_class = [to_class(c) for c in curated]
    pred_value = [to_class(p) for p in predicted]
    pred_confidence = list(confidence)
    pred_source = [s or "" for s in source]
    withheld = [""] * len(ids)
    split = [
        "trembl" if p else ("reference" if c else "")
        for c, p in zip(toxin_class, pred_value)
    ]

    references = [i for i, s in enumerate(split) if s == "reference"]
    held = set(references[::8])
    donor = ids[next(i for i in references if i not in held)]
    for i in held:
        withheld[i], toxin_class[i] = toxin_class[i], ""
        pred_value[i], pred_confidence[i], pred_source[i] = withheld[i], 0.9, donor
        split[i] = "holdout"

    annotations = (
        annotations.append_column("toxin_class", pa.array(toxin_class, pa.string()))
        .append_column("toxin_class__pred_value", pa.array(pred_value, pa.string()))
        .append_column(
            "toxin_class__pred_confidence",
            pa.array(
                [c if v else None for c, v in zip(pred_confidence, pred_value)],
                pa.float32(),
            ),
        )
        .append_column("toxin_class__pred_source", pa.array(pred_source, pa.string()))
        .append_column("toxin_class_withheld", pa.array(withheld, pa.string()))
        .append_column("eat_split", pa.array(split, pa.string()))
    )

    legend = json.loads(read_table(parts[3]).column("settings_json")[0].as_py())
    envelope = {
        "legendSettings": legend,
        "exportOptions": {},
        "eatOverlayEnabled": True,
        "eatConfidenceThreshold": 0.5,
    }
    settings = pa.table({"settings_json": [json.dumps(envelope, ensure_ascii=False)]})
    return DELIMITER.join(
        [to_parquet(annotations), parts[1], parts[2], to_parquet(settings), parts[4]]
    )


@dataclass(frozen=True)
class Role:
    file: str
    derive: Callable[[], bytes]


ROLES = [
    Role("example_role_small_5181.parquetbundle", small),
    Role("example_role_other_1587.parquetbundle", other),
    Role("example_role_slow_40026.parquetbundle", slow),
    Role("example_role_eat_811.parquetbundle", eat),
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--check", action="store_true", help="fail if a committed fixture is stale"
    )
    args = parser.parse_args()
    stale = []
    for role in ROLES:
        blob = role.derive()
        path = FIXTURES / role.file
        if args.check:
            if not path.is_file() or path.read_bytes() != blob:
                stale.append(role.file)
            continue
        path.write_bytes(blob)
        print(f"wrote {path.relative_to(FIXTURES.parents[3])} ({len(blob):,} B)")
    if stale:
        print(f"stale: {', '.join(stale)}; rerun without --check", file=sys.stderr)
        return 1
    if args.check:
        print("all role fixtures are up to date")
    return 0


if __name__ == "__main__":
    sys.exit(main())
