/**
 * The parquetbundle v3 wire vocabulary: footer keys, physical column names and part 6
 * payload names. Shared by the bundle writer (utils) and the bundle reader (core), so a
 * rename on one side is a compile-time change on both. The layout itself is specified in
 * `docs/guide/data-format.md`; Python's encoder (`bundle_v3.py`) spells the same names.
 */

/**
 * Part 1 key-value metadata key carrying the container version. Its presence is what makes
 * a bundle format v3; a legacy (v1/v2) bundle never carries it.
 */
export const V3_CONTAINER_VERSION_KEY = 'protspace_container_version';

/** The container version this writer emits and the only one the reader understands. */
export const V3_CONTAINER_VERSION = 3;

/** Part 1 key-value metadata key carrying the v3 manifest (JSON). */
export const V3_MANIFEST_KEY = 'protspace_v3_manifest';

/** Payload name of the dictionary every column's evidence codes index into. */
export const V3_EVIDENCE_DICT_NAME = '__evidence';

/** Projection axes, in part 3 column order. */
export const V3_AXES = ['x', 'y', 'z'] as const;

/** Physical part 1 column backing a manifest column: a multi-valued one stores hit counts. */
export function v3PhysicalColumn(name: string, kind: 'categorical' | 'multi' | 'numeric'): string {
  return kind === 'multi' ? `${name}__count` : name;
}

/** Part 3 column holding axis `axis` (0 = x) of projection `projection`. */
export function v3AxisColumn(projection: string, axis: number): string {
  return `${projection}__${V3_AXES[axis]}`;
}

/** Part 6 payload names for column (or dictionary) `name`. */
export const v3Payload = {
  /** The column's labels, utf8, concatenated. */
  dictionary: (name: string) => `dict:${name}`,
  /** The byte length of each label in `dict:<name>`. */
  dictionaryLengths: (name: string) => `dict:${name}:len`,
  /** A multi-valued column's hit codes, row after row. */
  codes: (name: string) => `csr:${name}`,
  /** The number of scores each hit carries. */
  scoreCounts: (name: string) => `score_count:${name}`,
  /** Every hit's scores, concatenated. */
  scores: (name: string) => `scores:${name}`,
  /** Each hit's code into the shared evidence dictionary. */
  evidence: (name: string) => `evidence:${name}`,
} as const;
