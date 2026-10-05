# /// script
# requires-python = ">=3.11"
# dependencies = ["pyarrow>=15", "numpy>=1.26"]
# ///
"""Synthetic v3 parquetbundles of any size, for the scaling benchmark.

    uv run perf/scale/generate.py swissprot --source apps/web/public/data/573K_swissprot.parquetbundle \\
        --n 5000000 --out /path/swissprot-5M.parquetbundle
    uv run perf/scale/generate.py lean --n 67108864 --out /path/lean-2^26.parquetbundle

swissprot resamples the source rows with replacement, every annotation included (codes,
hits and scores as they are, so category frequencies stay those of the source), gives
each row a new UniProt-like accession, and jitters both projections with Gaussian
noise whose sigma is half the source row's distance to its 5th nearest neighbour.

lean is the cheapest bundle per row that still exercises every path: one categorical
column (50 categories), one multi-valued column (300 labels, 2 hits per protein),
sorted ids and two 2-D projections, the second a rotated, noisy copy of the first.

Rows are written in chunks (default 1M) through bundle_writer.BundleWriter, so peak
memory does not grow with --n. Chunk i draws from its own generator, seeded (seed, i),
so the same seed and chunk size give the same bundle.
"""

from __future__ import annotations

import argparse
import io
import json
import resource
import sys
import time
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bundle_writer import (
    DELIMITER,
    BundleWriter,
    Categorical,
    Multi,
    MultiChunk,
    Numeric,
    Projection,
)

# --------------------------------------------------------------------------- #
# UniProt-like accessions
# --------------------------------------------------------------------------- #

DIGITS = b"0123456789"
ALNUM = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"  # ASCII order, so ids sort like indices
LETTERS = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ"
# [OPQ][0-9][A-Z0-9]{3}[0-9]
SIX = [b"OPQ", DIGITS, ALNUM, ALNUM, ALNUM, DIGITS]
# [A-NR-Z][0-9][A-Z][A-Z0-9]{2}[0-9] twice over; only R-Z as first letter, so every
# 10-character id sorts after every 6-character one (O, P, Q < R).
TEN = [
    b"RSTUVWXYZ",
    DIGITS,
    LETTERS,
    ALNUM,
    ALNUM,
    DIGITS,
    LETTERS,
    ALNUM,
    ALNUM,
    DIGITS,
]
SIX_COUNT = int(np.prod([len(a) for a in SIX]))
TEN_COUNT = int(np.prod([len(a) for a in TEN]))


def _mixed_radix(values: np.ndarray, alphabets: list[bytes]) -> np.ndarray:
    """(n, len(alphabets)) uint8 characters of `values` in the given digit alphabets."""
    out = np.empty((values.size, len(alphabets)), dtype=np.uint8)
    rest = values.astype(np.int64)
    for position in range(len(alphabets) - 1, -1, -1):
        alphabet = np.frombuffer(alphabets[position], dtype=np.uint8)
        rest, digit = np.divmod(rest, alphabet.size)
        out[:, position] = alphabet[digit]
    return out


def accessions(index: np.ndarray) -> pa.Array:
    """The accession of each index: unique, and ascending with the index."""
    index = np.asarray(index, dtype=np.int64)
    if index.size and index.max() >= SIX_COUNT + TEN_COUNT:
        raise ValueError("accession index out of range")
    six = index < SIX_COUNT
    widths = np.where(six, 6, 10)
    offsets = np.zeros(index.size + 1, dtype=np.int32)
    np.cumsum(widths, out=offsets[1:])
    data = np.empty(int(offsets[-1]), dtype=np.uint8)
    for mask, alphabets, base in ((six, SIX, 0), (~six, TEN, SIX_COUNT)):
        if mask.any():
            chars = _mixed_radix(index[mask] - base, alphabets)
            positions = offsets[:-1][mask, None] + np.arange(len(alphabets))
            data[positions] = chars
    return pa.StringArray.from_buffers(
        index.size, pa.py_buffer(offsets), pa.py_buffer(data)
    )


def _affine_permutation(n: int, seed: int) -> tuple[int, int]:
    """(a, b) with gcd(a, n) = 1, so i -> (a*i + b) mod n is a bijection on [0, n)."""
    if n == 1:
        return 1, 0
    rng = np.random.default_rng([seed, 7])
    a = int(rng.integers(n // 3, n))
    while np.gcd(a, n) != 1:
        a = a % (n - 1) + 1
    return a, int(rng.integers(0, n))


# --------------------------------------------------------------------------- #
# source bundle
# --------------------------------------------------------------------------- #


def _offsets(counts: np.ndarray) -> np.ndarray:
    offsets = np.zeros(counts.size + 1, dtype=np.int64)
    np.cumsum(counts, out=offsets[1:])
    return offsets


def _labels(payloads: dict[str, bytes], name: str) -> list[str]:
    blob = payloads[f"dict:{name}"]
    lengths = np.frombuffer(payloads[f"dict:{name}:len"], dtype="<i4")
    ends = np.cumsum(lengths)
    return [blob[e - n : e].decode("utf-8") for n, e in zip(lengths, ends)]


class Source:
    """A v3 bundle held as numpy arrays, ready to be resampled."""

    def __init__(self, path: Path):
        parts = path.read_bytes().split(DELIMITER)
        if len(parts) != 6:
            raise ValueError(f"{path} is not a format v3 bundle ({len(parts)} parts)")
        part1 = pq.read_table(io.BytesIO(parts[0]))
        manifest = json.loads(part1.schema.metadata[b"protspace_v3_manifest"])
        payload_table = pq.read_table(io.BytesIO(parts[5]))
        payloads = dict(
            zip(
                payload_table.column("name").to_pylist(),
                payload_table.column("data").to_pylist(),
            )
        )
        self.rows = part1.num_rows
        self.columns: list = []
        self.data: dict[str, dict[str, np.ndarray]] = {}
        for name, entry in manifest["columns"].items():
            kind, source_type = entry["kind"], entry.get("sourceType")
            if entry.get("evidence") or entry.get("placedNumeric"):
                raise ValueError(
                    f"column {name}: evidence / placedNumeric are not resampled"
                )
            if kind == "numeric":
                self.columns.append(
                    Numeric(name, entry.get("numericType", "float"), source_type)
                )
                self.data[name] = {"values": part1.column(name).to_numpy()}
            elif kind == "categorical":
                self.columns.append(
                    Categorical(name, _labels(payloads, name), source_type)
                )
                self.data[name] = {"codes": part1.column(name).to_numpy()}
            else:
                scored = bool(entry.get("scores"))
                self.columns.append(
                    Multi(name, _labels(payloads, name), scored, source_type)
                )
                counts = part1.column(f"{name}__count").to_numpy()
                column = {
                    "offsets": _offsets(counts),
                    "codes": np.frombuffer(payloads[f"csr:{name}"], dtype="<i4"),
                }
                if scored:
                    score_counts = np.frombuffer(
                        payloads[f"score_count:{name}"], dtype="<i4"
                    )
                    column["score_counts"] = score_counts
                    column["score_offsets"] = _offsets(score_counts)
                    column["scores"] = np.frombuffer(
                        payloads[f"scores:{name}"], dtype="<f8"
                    )
                self.data[name] = column

        part2 = pq.read_table(io.BytesIO(parts[1])).to_pylist()
        info = {
            row["projection_name"]: json.loads(row["info_json"] or "{}")
            for row in part2
        }
        part3 = pq.read_table(io.BytesIO(parts[2]))
        self.projections: list[Projection] = []
        self.coords: dict[str, np.ndarray] = {}
        for entry in manifest["projections"]:
            name, dimension = entry["name"], entry["dimension"]
            self.projections.append(Projection(name, dimension, info.get(name)))
            self.coords[name] = np.column_stack(
                [
                    part3.column(f"{name}__{axis}").to_numpy()
                    for axis in "xyz"[:dimension]
                ]
            )


def _gather(offsets: np.ndarray, rows: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Per-row counts and the flat element indices of `rows` in a CSR layout."""
    starts = offsets[rows]
    counts = offsets[rows + 1] - starts
    out = _offsets(counts)
    index = np.arange(out[-1], dtype=np.int64) + np.repeat(starts - out[:-1], counts)
    return counts.astype(np.int32), index


# --------------------------------------------------------------------------- #
# k-th nearest neighbour distance (approximate)
# --------------------------------------------------------------------------- #


def _spread_bits(v: np.ndarray) -> np.ndarray:
    """Interleave zeros between the low 21 bits of `v` (for 2-D Morton codes)."""
    v = v.astype(np.uint64) & np.uint64(0x1FFFFF)
    for shift, mask in (
        (16, 0x0000_FFFF_0000_FFFF),
        (8, 0x00FF_00FF_00FF_00FF),
        (4, 0x0F0F_0F0F_0F0F_0F0F),
        (2, 0x3333_3333_3333_3333),
        (1, 0x5555_5555_5555_5555),
    ):
        v = (v | (v << np.uint64(shift))) & np.uint64(mask)
    return v


def kth_neighbour_distance(
    xy: np.ndarray, k: int = 5, window: int = 24, shifts: int = 4, block: int = 65536
) -> np.ndarray:
    """Distance from each point to its k-th nearest other point, approximately.

    Points are sorted along Z-order curves of a few shifted grids, and each is
    compared with its `window` predecessors and successors on every curve: the
    shifted-curve kNN of Liao et al. Distances are upper bounds of the exact ones and
    close to them (see perf/README.md for the check). Non-finite rows get NaN.
    """
    if xy.ndim != 2 or xy.shape[1] != 2:
        raise ValueError(f"kth_neighbour_distance takes (n, 2) points, not {xy.shape}")
    out = np.full(len(xy), np.nan)
    finite = np.flatnonzero(np.isfinite(xy).all(axis=1))
    points = xy[finite].astype(np.float64)
    m = len(points)
    if m <= k:
        return out
    lo = points.min(axis=0)
    scale = (2**20 - 1) / max(float((points.max(axis=0) - lo).max()), 1e-30)
    grid = ((points - lo) * scale).astype(np.int64)  # in [0, 2^20)
    best_d = np.full((m, k), np.inf)
    best_i = np.full((m, k), -1, dtype=np.int64)
    rng = np.random.default_rng(0)
    for s in range(shifts):
        offset = 0 if s == 0 else rng.integers(0, 2**20, size=2)
        shifted = grid + offset
        order = np.argsort(
            _spread_bits(shifted[:, 0]) | (_spread_bits(shifted[:, 1]) << np.uint64(1))
        )
        rank = np.empty(m, dtype=np.int64)
        rank[order] = np.arange(m)
        steps = np.concatenate([np.arange(-window, 0), np.arange(1, window + 1)])
        for lo_row in range(0, m, block):
            rows = slice(lo_row, min(lo_row + block, m))
            own = np.arange(rows.start, rows.stop)
            neighbour = order[np.clip(rank[rows, None] + steps, 0, m - 1)]
            d = np.hypot(
                *(points[neighbour] - points[rows, None, :]).transpose(2, 0, 1)
            )
            d[neighbour == own[:, None]] = np.inf  # a clipped step lands on itself
            cand_d = np.concatenate([best_d[rows], d], axis=1)
            cand_i = np.concatenate([best_i[rows], neighbour], axis=1)
            # Sort by (distance, index) so a neighbour found twice sits in adjacent slots.
            sort = np.lexsort((cand_i, cand_d), axis=1)
            cand_d = np.take_along_axis(cand_d, sort, axis=1)
            cand_i = np.take_along_axis(cand_i, sort, axis=1)
            cand_d[:, 1:][cand_i[:, 1:] == cand_i[:, :-1]] = np.inf
            sort = np.argsort(cand_d, axis=1, kind="stable")[:, :k]
            best_d[rows] = np.take_along_axis(cand_d, sort, axis=1)
            best_i[rows] = np.take_along_axis(cand_i, sort, axis=1)
    out[finite] = best_d[:, k - 1]
    return out


def jitter_sigma(xy: np.ndarray) -> np.ndarray:
    """Half the 5th-neighbour distance per row; exact duplicates get the 1st percentile."""
    sigma = 0.5 * kth_neighbour_distance(xy, 5)
    positive = sigma[np.isfinite(sigma) & (sigma > 0)]
    floor = float(np.percentile(positive, 1)) if positive.size else 0.0
    sigma[np.isfinite(sigma) & (sigma <= 0)] = floor
    return sigma


# --------------------------------------------------------------------------- #
# profiles
# --------------------------------------------------------------------------- #


def _chunks(n: int, chunk: int):
    for index, start in enumerate(range(0, n, chunk)):
        yield index, start, min(start + chunk, n)


def swissprot(args) -> dict:
    t0 = time.perf_counter()
    source = Source(Path(args.source))
    sigmas = {name: jitter_sigma(xy) for name, xy in source.coords.items()}
    print(
        f"source: {source.rows} rows, {len(source.columns)} columns, kNN sigma in "
        f"{time.perf_counter() - t0:.1f}s",
        flush=True,
    )
    a, b = _affine_permutation(args.n, args.seed)

    with BundleWriter(
        args.out, source.columns, source.projections, tmp_dir=args.tmp
    ) as writer:
        for index, start, end in _chunks(args.n, args.chunk):
            n = end - start
            rng = np.random.default_rng([args.seed, index])
            rows = rng.integers(0, source.rows, size=n)
            annotations = {}
            for column in source.columns:
                data = source.data[column.name]
                if isinstance(column, Numeric):
                    annotations[column.name] = data["values"][rows]
                elif isinstance(column, Categorical):
                    annotations[column.name] = data["codes"][rows]
                else:
                    counts, hits = _gather(data["offsets"], rows)
                    chunk = MultiChunk(counts, data["codes"][hits])
                    if column.scores:
                        _, score_index = _gather(data["score_offsets"], hits)
                        chunk.score_counts = data["score_counts"][hits]
                        chunk.scores = data["scores"][score_index]
                    annotations[column.name] = chunk
            projections = {
                name: xy[rows]
                + rng.standard_normal(xy[rows].shape) * sigmas[name][rows, None]
                for name, xy in source.coords.items()
            }
            ids = accessions((np.arange(start, end, dtype=np.int64) * a + b) % args.n)
            writer.write_chunk(ids, annotations, projections)
            print(
                f"  {end:>12,} rows  {time.perf_counter() - t0:7.1f}s  peak {_peak_rss_bytes() / 2**20:,.0f} MiB",
                flush=True,
            )
    return writer.stats


LEAN_CATEGORIES = 50
LEAN_LABELS = 300


def _zipf(count: int, exponent: float) -> np.ndarray:
    weights = 1.0 / np.arange(1, count + 1) ** exponent
    return weights / weights.sum()


def lean(args) -> dict:
    t0 = time.perf_counter()
    columns = [
        Categorical("group", [f"group_{i:02d}" for i in range(LEAN_CATEGORIES)]),
        Multi("tags", [f"tag_{i:03d}" for i in range(LEAN_LABELS)]),
    ]
    projections = [Projection("clustered", 2), Projection("rotated", 2)]
    layout = np.random.default_rng([args.seed, 1])
    centres = layout.uniform(-20, 20, size=(LEAN_CATEGORIES, 2))
    spreads = layout.uniform(0.3, 1.5, size=LEAN_CATEGORIES)
    group_p = _zipf(LEAN_CATEGORIES, 0.8)
    tag_p = _zipf(LEAN_LABELS, 1.0)
    angle = np.deg2rad(60)
    rotation = np.array(
        [[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]]
    )

    with BundleWriter(args.out, columns, projections, tmp_dir=args.tmp) as writer:
        for index, start, end in _chunks(args.n, args.chunk):
            n = end - start
            rng = np.random.default_rng([args.seed, index])
            group = rng.choice(LEAN_CATEGORIES, size=n, p=group_p).astype(np.int32)
            first = rng.choice(LEAN_LABELS, size=n, p=tag_p)
            second = (
                first + 1 + rng.integers(0, LEAN_LABELS - 1, size=n)
            ) % LEAN_LABELS
            tags = MultiChunk(
                np.full(n, 2, np.int32), np.column_stack([first, second]).ravel()
            )
            clustered = (
                centres[group] + rng.standard_normal((n, 2)) * spreads[group, None]
            )
            rotated = clustered @ rotation.T + rng.standard_normal((n, 2)) * 1.5
            writer.write_chunk(
                accessions(np.arange(start, end, dtype=np.int64)),
                {"group": group, "tags": tags},
                {"clustered": clustered, "rotated": rotated},
            )
            print(
                f"  {end:>12,} rows  {time.perf_counter() - t0:7.1f}s  peak {_peak_rss_bytes() / 2**20:,.0f} MiB",
                flush=True,
            )
    return writer.stats


def _peak_rss_bytes() -> int:
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return peak if sys.platform == "darwin" else peak * 1024


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("profile", choices=["swissprot", "lean"])
    parser.add_argument("--n", type=int, required=True, help="number of proteins")
    parser.add_argument("--out", required=True, help="output .parquetbundle")
    parser.add_argument("--source", help="v3 bundle to resample (swissprot)")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument(
        "--chunk", type=int, default=1_000_000, help="rows per row group"
    )
    parser.add_argument(
        "--tmp", help="directory for temporary files (default: system temp)"
    )
    args = parser.parse_args()
    if args.n < 1:
        parser.error("--n must be positive")
    if args.profile == "swissprot" and not args.source:
        parser.error("swissprot needs --source")

    t0 = time.perf_counter()
    stats = swissprot(args) if args.profile == "swissprot" else lean(args)
    seconds = time.perf_counter() - t0
    print(
        f"rows {stats['rows']:,}  file {stats['bytes'] / 2**20:,.1f} MiB "
        f"(part1 {stats['part1_bytes'] / 2**20:,.1f}, part3 {stats['part3_bytes'] / 2**20:,.1f}, "
        f"part6 {stats['part6_bytes'] / 2**20:,.1f})  time {seconds:,.1f}s  "
        f"peak RSS {_peak_rss_bytes() / 2**20:,.0f} MiB  -> {args.out}"
    )


if __name__ == "__main__":
    main()
