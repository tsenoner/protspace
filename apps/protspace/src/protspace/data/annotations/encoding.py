"""Lossless percent-encoding for annotation value serialization (bundle format v2).

Categorical annotation cells use the grammar
``accession (name)|score,score;accession2 (name2)|EVIDENCE``. The structural
characters ``;`` (hit separator) and ``|`` (label/score separator) also occur
inside human names from external databases, which corrupts parsing. To keep the
cell losslessly parseable, every free-text token (name, bare-text label,
evidence) is percent-encoded over a minimal reserved set before assembly and
decoded at display.

Reserved set: ``%`` (escape), ``;``, ``|``, and all C0/DEL control chars
(0x00-0x1F, 0x7F). ``,`` ``(`` ``)`` are deliberately NOT encoded: commas are
positionally isolated after ``|`` and parens are display sugar, so leaving them
literal keeps names maximally readable.
"""

import json
import re

import pandas as pd
import pyarrow as pa

#: The annotation **cell grammar** version: ``1`` is the legacy raw-text grammar,
#: ``2`` the percent-encoded one this module writes.  It is stamped under
#: :data:`FORMAT_VERSION_KEY` on every v2-shaped annotations table (a legacy
#: bundle's part 1, the tables a v3 read hands back, the pipeline's own
#: parquets), and a missing stamp reads as v1.  It does **not** version the
#: container: a v3 bundle says so under ``protspace_container_version``
#: (:data:`~protspace.data.io.bundle_v3.CONTAINER_VERSION_KEY`) and carries no
#: grammar stamp, because its labels are stored decoded.
BUNDLE_FORMAT_VERSION = 2
FORMAT_VERSION_KEY = b"protspace_format_version"

# Columns of the intermediate annotation cache (``all_annotations.parquet``)
# whose *stored meaning* changed, keyed by the cache version that changed it.
# This is distinct from BUNDLE_FORMAT_VERSION above, which versions the wire
# format the frontend reads: here the schema is unchanged and only the
# interpretation of a cell moved, so a stale value cannot be repaired locally
# and has to be refetched (or dropped) instead of reused.
#
#   v1: xref_pdb distinguishes "no UniProt entry" ("") from "no PDB" ("False")
#   v2: protein_families keeps names whole ("(TC 3.A.3)" is no longer cut at
#       its first ".") and lists every section's family instead of a section
#       qualifier; the InterPro columns reach every protein sharing a sequence,
#       where v1 gave them to only one of each group, and hold member-database
#       matches only, where v1 also took InterPro-N's AI-predicted ones
#   v3: root is the top node of the lineage ("cellular organisms", "Viruses"),
#       where v2 kept its deepest unranked clade ("melanogaster subgroup");
#       predicted_transmembrane calls a TMbed negative "non-transmembrane",
#       where v2 wrote "none", a token the CLI and the web app read as missing
#
# To record a new semantics change, add an entry — the version is derived from
# this table, so the two cannot drift apart. The pipeline reads nothing else to
# decide which columns and sources a legacy cache must refresh.
#
# The InterPro columns are spelled out rather than imported: the retriever
# imports this module. A test pins them to `INTERPRO_ANNOTATIONS`.
_INTERPRO_COLUMNS = frozenset(
    {
        "pfam",
        "superfamily",
        "cath",
        "signal_peptide",
        "smart",
        "cdd",
        "panther",
        "prosite",
        "prints",
        "pfam_clan",
    }
)
CACHE_SEMANTICS_CHANGES: dict[int, frozenset[str]] = {
    1: frozenset({"xref_pdb"}),
    2: frozenset({"protein_families"}) | _INTERPRO_COLUMNS,
    3: frozenset({"root", "predicted_transmembrane"}),
}
ANNOTATION_CACHE_VERSION = max(CACHE_SEMANTICS_CHANGES)
ANNOTATION_CACHE_VERSION_ATTR = "protspace_annotation_cache_version"

# Boolean-ish annotations (``xref_pdb``, ``signal_peptide``, ...) persist as these
# exact strings. Cached values are read back and re-transformed on resumed runs,
# so every transform that emits one must also accept one unchanged — otherwise a
# second pass reinterprets its own output as raw source data.
CANONICAL_BOOLEANS = ("False", "True")

# The labels an Arrow ``BOOLEAN`` annotation column is stored as in a v3 bundle:
# lower case, as the browser has always displayed one (``String(true)``), so
# legend colours saved against a v2 bundle keep matching. Not CANONICAL_BOOLEANS,
# which are string cells the pipeline writes itself.
ARROW_BOOLEAN_LABELS = ("false", "true")

# Chars that must be percent-encoded inside any free-text token.
_RESERVED = {";", "|", "%"} | {chr(c) for c in range(0x20)} | {chr(0x7F)}
_ENCODE_TABLE = str.maketrans({c: f"%{ord(c):02X}" for c in _RESERVED})
_DECODE_RE = re.compile(r"%([0-9A-Fa-f]{2})")


def encode_field(s: str) -> str:
    """Percent-encode the reserved set inside a free-text token. Lossless."""
    return s.translate(_ENCODE_TABLE)


def decode_field(s: str) -> str:
    """Inverse of :func:`encode_field`. A no-op on text without ``%``."""
    if "%" not in s:
        return s
    return _DECODE_RE.sub(lambda m: chr(int(m.group(1), 16)), s)


def read_format_version(table: pa.Table | pa.Schema) -> int:
    """Return the annotations' cell-grammar version, defaulting unstamped tables to v1.

    Right for a table read from a legacy bundle, whose missing stamp really does
    mean v1.  Not a test of whether a table *was* stamped: the v3 encoder, which
    must not guess, uses :func:`has_format_version` for that.
    """
    schema = table if isinstance(table, pa.Schema) else table.schema
    metadata = schema.metadata or {}
    try:
        return int(metadata.get(FORMAT_VERSION_KEY, b"1"))
    except (TypeError, ValueError):
        return 1


def has_format_version(table: pa.Table | pa.Schema) -> bool:
    """Whether the table carries a :data:`FORMAT_VERSION_KEY` stamp at all."""
    schema = table if isinstance(table, pa.Schema) else table.schema
    return FORMAT_VERSION_KEY in (schema.metadata or {})


def read_annotation_cache_version(df: pd.DataFrame) -> int:
    """Return the annotation cache's semantic version, defaulting legacy caches to 0.

    pandas round-trips ``DataFrame.attrs`` through the Parquet file's key-value
    metadata, so an unstamped cache is one written before versioning existed.
    """
    try:
        return int(df.attrs.get(ANNOTATION_CACHE_VERSION_ATTR, 0))
    except (TypeError, ValueError):
        return 0


def annotation_cache_version_attrs() -> dict[str, int]:
    """Return the ``DataFrame.attrs`` marking a cache as current."""
    return {ANNOTATION_CACHE_VERSION_ATTR: ANNOTATION_CACHE_VERSION}


def is_annotation_cache(table: pa.Table | pa.Schema) -> bool:
    """Whether a parquet table is the pipeline's own ``all_annotations.parquet``.

    Recognised by the cache-version attribute pandas stores in the footer's
    ``PANDAS_ATTRS``.  The emit sites have percent-encoded every cache cell since
    before that attribute existed, so a table that carries it holds v2 cells even
    when it predates the cache's :data:`FORMAT_VERSION_KEY` stamp.
    """
    schema = table if isinstance(table, pa.Schema) else table.schema
    raw = (schema.metadata or {}).get(b"PANDAS_ATTRS")
    if raw is None:
        return False
    try:
        attrs = json.loads(raw)
    except (TypeError, ValueError):
        return False
    return isinstance(attrs, dict) and ANNOTATION_CACHE_VERSION_ATTR in attrs


def stale_cache_columns(df: pd.DataFrame) -> set[str]:
    """Return the columns of ``df`` whose values predate their current meaning.

    Empty for a cache stamped with the current version, so the common resumed
    run pays only one metadata lookup.
    """
    version = read_annotation_cache_version(df)
    return {
        column
        for changed_at, columns in CACHE_SEMANTICS_CHANGES.items()
        if version < changed_at
        for column in columns
    } & set(df.columns)


def _split_legacy_hits(value: str) -> list[str]:
    """Split v1 hits while retaining semicolons inside balanced label parentheses."""
    parts: list[str] = []
    depth = 0
    start = 0
    for index, character in enumerate(value):
        if character == "(":
            depth += 1
        elif character == ")" and depth > 0:
            depth -= 1
        elif character == ";" and depth == 0:
            parts.append(value[start:index])
            start = index + 1
    parts.append(value[start:])
    return value.split(";") if depth != 0 else parts


def encode_legacy_cell(value: str) -> str:
    """Migrate one legacy categorical cell without changing its parsed hit structure.

    A hit splits at its *last* ``|``, as the browser's v1 reader
    (``parseAnnotationValueImpl`` in ``conversion.ts``) reads it: in
    ``"A (x|1;y)|0.5"`` the label is ``A (x|1;y)`` and the score ``0.5``.  Every
    earlier ``|`` belongs to the label and is escaped with it.
    """
    encoded_hits: list[str] = []
    for hit in _split_legacy_hits(value):
        label, separator, suffix = hit.rpartition("|")
        if not separator:
            label = suffix
        encoded = encode_field(label)
        if separator:
            encoded = f"{encoded}|{encode_field(suffix)}"
        encoded_hits.append(encoded)
    return ";".join(encoded_hits)


def _text_type(type_: pa.DataType) -> pa.DataType | None:
    """The string type a column's cells are text of, ``None`` for any other column.

    A dictionary of strings (a pandas ``category`` column) holds text cells as
    much as a plain string column does, and the encoder reads it as text.
    """
    if pa.types.is_dictionary(type_):
        type_ = type_.value_type
    if pa.types.is_string(type_) or pa.types.is_large_string(type_):
        return type_
    return None


def _migrate_cells(table: pa.Table) -> pa.Table:
    """Re-emit every text annotation of a v1 table in the v2 grammar, stamped.

    A dictionary-of-strings column comes back as its plain string type.
    """
    columns = []
    for name, column in zip(table.column_names, table.columns, strict=True):
        text_type = _text_type(column.type)
        if name in {"identifier", "protein_id"} or text_type is None:
            columns.append(column)
            continue
        opaque_source = name.endswith("__pred_source")
        migrated = [
            None
            if value is None
            else encode_field(value)
            if opaque_source
            else encode_legacy_cell(value)
            for value in column.to_pylist()
        ]
        columns.append(pa.array(migrated, type=text_type))
    return stamp_format_version(pa.Table.from_arrays(columns, names=table.column_names))


def migrate_legacy_annotation_table(table: pa.Table) -> pa.Table:
    """Re-emit a v1 table's string annotations in the unambiguous v2 grammar.

    The grammar is read from the table's own stamp, so this is for a table whose
    stamp is intact -- one read straight from a legacy bundle.  A table stamped
    v2 or later is returned untouched and the result is stamped, so a second call
    is a no-op.

    **The double-migration hazard.**  Migrating a table that is already v2
    escapes every reserved character a second time (``%3B`` becomes ``%253B``),
    unrecoverably, because :func:`decode_field` is not its own inverse.  pyarrow
    drops schema metadata on ``rename_columns``, so a v2 table renamed that way
    reads as v1.  A caller holding such a table uses
    :func:`upgrade_cell_grammar` with the version it read *before* the stamp was
    lost; the v3 encoder refuses an unstamped table rather than guess.
    """
    if read_format_version(table) >= BUNDLE_FORMAT_VERSION:
        return table
    return _migrate_cells(table)


def upgrade_cell_grammar(table: pa.Table, version: int) -> pa.Table:
    """Bring a table whose cells are in grammar ``version`` to v2, stamped.

    For callers that know the grammar from somewhere other than the table's own
    stamp: read before an operation dropped it (``transfer``), or decided at a
    trust boundary (``protspace bundle -a``).  ``1`` migrates, ``2`` only
    stamps; anything else is refused.
    """
    if version == 1:
        return _migrate_cells(table)
    if version == BUNDLE_FORMAT_VERSION:
        return stamp_format_version(table)
    raise ValueError(
        f"unknown annotation cell grammar v{version}; expected 1 (legacy) or "
        f"{BUNDLE_FORMAT_VERSION}"
    )


def to_display_value(raw, *, decode: bool = True):
    """Convert a whole annotation cell into its scalar human-display value.

    The shared transform behind every display path (the Dash ``serve``
    plot/legend/hover, the style keys, and the ``style`` template), so they key
    on the same value. Applied per hit (``;``-separated), then re-joined:

    1. **Pipe trim** – drop each hit's ``|score``/``|evidence`` suffix
       (``"cluster 3|0.53"`` → ``"cluster 3"``), so per-point score noise does
       not shatter a category.
    2. **Percent-decode** – v2 bundles percent-encode ``;``/``|``/``%`` and
       control chars inside free-text names; decode back to the literal
       characters for display.

    ``decode`` gates step 2 on the bundle format version: pass
    ``format_version >= 2``. A legacy (v1) value that legitimately contains a
    literal ``%XX`` is then left untouched. Non-strings (missing/``None`` or
    numeric annotations) pass through unchanged.

    A multi-hit cell stays ONE category — every hit is score-stripped/decoded
    and re-joined with ``;`` (``"A|0.9;B|0.8"`` → ``"A;B"``); dropping the
    suffix per hit (not once on the whole cell) is what keeps hits 2+ from being
    swallowed by the first hit's ``|``. The ``style`` template instead keeps the
    hits as a list (see ``add_annotation_style._to_display_value``) to key each
    label separately, matching the web frontend's multi-label legend.
    """
    if not isinstance(raw, str):
        return raw
    hits = (hit.split("|", 1)[0] for hit in raw.split(";"))
    if decode:
        hits = (decode_field(hit) for hit in hits)
    return ";".join(hits)


def stamp_format_version(table: pa.Table) -> pa.Table:
    """Declare a table's cells to be in the v2 grammar, in its schema metadata.

    Only for cells that really are v2: stamping a v1 table skips the migration
    it needs (see :func:`upgrade_cell_grammar`).

    pyarrow writes these as top-level parquet file key-value metadata, readable
    by hyparquet on the frontend via ``parquetMetadata().key_value_metadata``.
    """
    existing = table.schema.metadata or {}
    return table.replace_schema_metadata(
        {
            **existing,
            FORMAT_VERSION_KEY: str(BUNDLE_FORMAT_VERSION).encode(),
        }
    )
