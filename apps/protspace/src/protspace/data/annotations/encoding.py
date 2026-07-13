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

import re

import pyarrow as pa

BUNDLE_FORMAT_VERSION = 2
FORMAT_VERSION_KEY = b"protspace_format_version"

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


def to_display_value(raw, *, decode: bool = True):
    """Convert one annotation hit into its scalar human-display value.

    The shared per-hit transform behind every display path (the Dash ``serve``
    plot/legend/hover, the style keys, and the ``style`` template), so they key
    on the same value:

    1. **Pipe trim** – drop the ``|score``/``|evidence`` suffix
       (``"cluster 3|0.53"`` → ``"cluster 3"``), so per-point score noise does
       not shatter a category.
    2. **Percent-decode** – v2 bundles percent-encode ``;``/``|``/``%`` and
       control chars inside free-text names; decode back to the literal
       characters for display.

    ``decode`` gates step 2 on the bundle format version: pass
    ``format_version >= 2``. A legacy (v1) value that legitimately contains a
    literal ``%XX`` is then left untouched. Non-strings (missing/``None`` or
    numeric annotations) pass through unchanged.

    Operates on a whole cell as one hit — the Dash plot passes the whole cell,
    keeping a multi-hit ``A;B`` as one category. The ``style`` template instead
    splits on ``;`` first (see ``add_annotation_style._to_display_value``) to
    key each label separately, matching the web frontend's multi-label legend.
    """
    if not isinstance(raw, str):
        return raw
    label = raw.split("|", 1)[0]
    return decode_field(label) if decode else label


def stamp_format_version(table: pa.Table) -> pa.Table:
    """Attach the bundle format version to a table's schema metadata.

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
