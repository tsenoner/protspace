"""Custom annotation files: a user's own table, given to any command as ``-a table.csv``.

One loader serves ``prepare``, ``annotate``, ``stats`` and ``bundle``, so a file means the same
thing to each of them:

- ``.csv``, ``.tsv`` and ``.txt`` (any case) are files; every other ``-a`` value is a source name.
- The delimiter is read off the header line (tab, comma or semicolon), not the extension.
- The first column holds the ids, whatever its header. A later column with a name ProtSpace
  reserves (:data:`RESERVED_COLUMNS`) is kept as an annotation under ``<name>_annotation``.
- Cells are text: an empty cell stays empty, and the plain text is encoded into the v2 cell
  grammar the way ``bundle -a`` encodes a hand-written table.
- Several files are joined on the id column; a column two files both define is an error.
- The result has one row per input protein, and ids that match none are warned about.
"""

import csv
import io
import logging
from collections.abc import Iterable, Sequence
from pathlib import Path

import pandas as pd

from protspace._generated.shared_constants import NON_ANNOTATION_COLUMNS
from protspace.data.annotations.encoding import encode_legacy_cell

logger = logging.getLogger(__name__)

CUSTOM_ANNOTATION_SUFFIXES = (".csv", ".tsv", ".txt")
ID_COLUMN = "identifier"

#: Names a later column of a custom file cannot keep, compared exactly: the names the web viewer
#: never shows as an annotation (shared with it through contracts/shared-constants.json), which
#: include the pipeline's and the bundle's id column (``identifier``, ``protein_id``).
RESERVED_COLUMNS = NON_ANNOTATION_COLUMNS
# A parquet's id column, by precedence: `protein_id` (a bundle), then `identifier` (the pipeline).
_PARQUET_ID_NAMES = ("protein_id", "identifier")
_DELIMITERS = {"\t": "tab", ",": "comma", ";": "semicolon"}
_EXAMPLES = 3


def is_custom_annotation_file(item: str | Path) -> bool:
    """Whether an ``-a`` value names a custom annotation file, judged by its suffix alone."""
    return Path(item).suffix.lower() in CUSTOM_ANNOTATION_SUFFIXES


def flatten_annotation_args(items: Iterable[str]) -> list[str]:
    """Repeatable, comma-separated ``-a`` values as one flat list.

    A value naming an existing custom file is kept whole, so a file name holding a comma
    (``labels, v2.csv``) is not split in two.
    """
    parts: list[str] = []
    for item in items:
        item = item.strip()
        if is_custom_annotation_file(item) and Path(item).is_file():
            parts.append(item)
        else:
            parts.extend(p.strip() for p in item.split(",") if p.strip())
    return parts


def split_annotation_args(items: Iterable[str]) -> tuple[list[str], list[Path]]:
    """Split repeatable, comma-separated ``-a`` values into source names and files.

    A value with another suffix that names an existing file (``labels.xlsx``) is refused here,
    since as a source name it would only fail later as "Unknown annotation".
    """
    names: list[str] = []
    files: list[Path] = []
    for part in flatten_annotation_args(items):
        if is_custom_annotation_file(part):
            files.append(Path(part))
        elif Path(part).suffix and Path(part).is_file():
            raise ValueError(
                f"{part}: custom annotations are read from .csv, .tsv or .txt "
                "files (comma, tab or semicolon separated)."
            )
        else:
            names.append(part)
    return names, files


def resolve_id_column(columns: Sequence[str]) -> str:
    """The column holding the protein ids of an annotations parquet (``stats -a``, ``bundle -a``).

    ``protein_id``, else ``identifier`` (the names every table ProtSpace writes gives it), else
    the first column. Beside ``protein_id``, an ``identifier`` column is an annotation, as the
    bundle encoder reads it. A custom annotation file does not use this: its first column is the
    id column, always (:func:`_read_file`).
    """
    for name in _PARQUET_ID_NAMES:
        if name in columns:
            return name
    if not len(columns):
        raise ValueError("The table has no columns.")
    return columns[0]


def _unreserved(path: Path, id_header: str, columns: Sequence[str]) -> list[str]:
    """*columns* (a file's non-first columns), each reserved name renamed ``<name>_annotation``.

    The column stays an annotation: before, such a file failed with a duplicate-column error, or
    the viewer hid the column.
    """
    taken = {*columns, ID_COLUMN}
    names: list[str] = []
    for column in columns:
        if column not in RESERVED_COLUMNS:
            names.append(column)
            continue
        new, n = f"{column}_annotation", 2
        while new in taken:
            new, n = f"{column}_annotation_{n}", n + 1
        taken.add(new)
        logger.warning(
            "%s: column '%s' is kept as the annotation '%s'. The first column, '%s', "
            "holds the ids, and ProtSpace reserves the name '%s'.",
            path,
            column,
            new,
            id_header,
            column,
        )
        names.append(new)
    return names


def _read_text(path: Path) -> str:
    try:
        # utf-8-sig drops the byte-order mark Excel writes, which would otherwise
        # become part of the first header name.
        text = path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError(f"{path}: not UTF-8 text ({exc.reason}).") from exc
    # A file edited on several systems can mix all three conventions.
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _sniff_delimiter(path: Path, header: str) -> str:
    """The candidate that splits the header into the most fields.

    Only the header votes: data cells legitimately hold commas (``Homo sapiens, human``) and
    semicolons (ProtSpace's own multi-value separator). A tie goes to the extension's delimiter.
    """
    preferred = "," if path.suffix.lower() == ".csv" else "\t"
    order = [preferred, *(d for d in _DELIMITERS if d != preferred)]
    counts = {d: len(next(csv.reader([header], delimiter=d), [])) for d in order}
    best = max(order, key=lambda d: counts[d])
    if counts[best] < 2:
        logger.warning(
            "%s parsed to a single column. Custom annotations need an id column and at "
            "least one annotation column, separated by a comma, tab or semicolon.",
            path,
        )
    return best


def _read_file(path: Path) -> pd.DataFrame:
    """One file as text, its first column renamed to :data:`ID_COLUMN`, one row per id."""
    text = _read_text(path)
    header = next((line for line in text.split("\n") if line.strip()), "")
    if not header:
        raise ValueError(f"{path}: the file is empty.")
    try:
        frame = pd.read_csv(
            io.StringIO(text),
            sep=_sniff_delimiter(path, header),
            dtype=str,
            keep_default_na=False,
        )
    except pd.errors.ParserError as exc:
        raise ValueError(f"{path}: {exc}") from exc
    id_header, *rest = (str(c).strip() for c in frame.columns)
    frame.columns = [ID_COLUMN, *_unreserved(path, id_header, rest)]
    frame[ID_COLUMN] = frame[ID_COLUMN].str.strip()
    frame = frame[frame[ID_COLUMN] != ""]

    repeated = frame[ID_COLUMN].duplicated()
    if repeated.any():
        logger.warning(
            "%s: %d repeated id(s), e.g. %r; keeping the first row of each.",
            path,
            int(repeated.sum()),
            frame.loc[repeated, ID_COLUMN].iloc[0],
        )
        frame = frame[~repeated]
    return frame


def _report_coverage(path: Path, ids: pd.Series, headers: Sequence[str]) -> None:
    known = set(headers)
    unmatched = [i for i in ids if i not in known]
    logger.info(
        "%s: %d of %d ids match one of the %d input proteins",
        path,
        len(ids) - len(unmatched),
        len(ids),
        len(headers),
    )
    if unmatched:
        logger.warning(
            "%s: %d of %d ids match no input protein and are ignored, e.g. %s. "
            "Input ids look like %s; ids must match them exactly.",
            path,
            len(unmatched),
            len(ids),
            ", ".join(map(repr, unmatched[:_EXAMPLES])),
            ", ".join(map(repr, list(headers)[:_EXAMPLES])),
        )


def load_custom_annotations(
    paths: Iterable[str | Path], headers: Sequence[str]
) -> pd.DataFrame:
    """Read custom annotation files into one frame keyed on the input's ids.

    Returns an :data:`ID_COLUMN` column holding exactly *headers*, in order, then every file's
    columns, empty where a file has no row for a protein. Cells are v2-encoded.
    """
    paths = list(dict.fromkeys(Path(p).resolve() for p in paths))
    merged = pd.DataFrame({ID_COLUMN: list(headers)})
    owner: dict[str, Path] = {}
    for path in paths:
        logger.info("Loading custom annotations from: %s", path)
        frame = _read_file(path)
        for column in frame.columns.drop(ID_COLUMN):
            if column in owner:
                raise ValueError(
                    f"Column '{column}' is in both {owner[column]} and {path}. "
                    "Rename it in one of them."
                )
            owner[column] = path
        _report_coverage(path, frame[ID_COLUMN], headers)
        merged = merged.merge(frame, on=ID_COLUMN, how="left")

    for column in merged.columns.drop(ID_COLUMN):
        merged[column] = merged[column].fillna("").map(encode_legacy_cell)
    return merged


def merge_custom_annotations(
    fetched: pd.DataFrame, custom: pd.DataFrame | None
) -> pd.DataFrame:
    """Lay custom columns over fetched annotations; a custom column wins on a name clash."""
    if custom is None:
        return fetched

    merged = fetched.merge(
        custom.drop_duplicates(ID_COLUMN),
        on=ID_COLUMN,
        how="left",
        suffixes=("_api", ""),
    )
    # Drop API-suffixed duplicates so custom values win
    for col in list(merged.columns):
        if col.endswith("_api"):
            base = col.removesuffix("_api")
            if base in merged.columns:
                merged = merged.drop(columns=[col])
            else:
                merged = merged.rename(columns={col: base})
    return merged
