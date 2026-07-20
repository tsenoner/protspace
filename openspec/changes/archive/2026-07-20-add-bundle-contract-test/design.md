# Design

## Layout

```
tests/contract/
  emit_bundles.py          Python generator, driven by the real CLI
  bundle.contract.test.ts  TypeScript spec, uses the real reader
  vitest.config.ts         standalone vitest project
```

The suite sits at the repository root rather than inside either package because it belongs to neither: it is the seam between them, and a reader looking for "what do these two agree on" should find one directory.

## Flow

```
vitest beforeAll
  └─ spawnSync('uv', ['run', '--package', 'protspace',
                      'python', 'tests/contract/emit_bundles.py', <tmpdir>])
         ├─ writes annotations.parquet            (10 proteins, v2 payload)
         ├─ writes projections_metadata.parquet   (one 2D + one 3D projection)
         ├─ writes projections_data.parquet
         ├─ writes settings.json, statistics.parquet
         └─ subprocess ×4: protspace bundle -a … -p … -o <variant>.parquetbundle

each test
  └─ extractRowsFromParquetBundle(readFileSync(<variant>.parquetbundle))
       → assert on real values, not just absence of throw
```

## Decision: vitest drives, Python emits

The alternative was pytest driving a Node reader shim. Rejected: the shim would need the TypeScript reader built or bundled for standalone Node, and the consumer's assertions would live in a language that is not the consumer's. With vitest driving, the reader runs inside the environment it is already tested in, resolves `@protspace/utils` through the existing pnpm workspace, and needs no build step. Python's only responsibility is "put canonical bundles at this path", which is a script, not a shim.

`bundle-roundtrip.test.ts` already reads bundle files off disk with `fs` and reaches across the repository into `apps/web/public/data/`, so this is the established pattern with the fixture generated instead of committed.

## Decision: the real CLI, not `write_bundle()`

`protspace bundle` performs two transformations that `write_bundle()` alone does not: the `identifier` → `protein_id` column rename, and `stamp_format_version`, which unconditionally marks the annotations table as v2. Both are contract surface the reader depends on — `readFormatVersion` returning `2` versus the legacy `1` default changes how labels are decoded. A generator that called `write_bundle()` directly would pass while the stamping was broken.

The cost is that the generator must construct the input parquets the `annotate` and `project` stages would have produced. That assumption is recorded as a comment in `emit_bundles.py` and as a non-goal in the proposal.

## Decision: standalone vitest project, not `skipIf`

A test inside `packages/core` guarded by `describe.skipIf(!hasUv())` would run under `pnpm test` when `uv` happens to be installed and silently vanish when it is not. That reintroduces the problem this change exists to remove: a green result that proved nothing. A standalone project invoked only by the contract workflow has two states, not three.

Consequence: `turbo test` does not run the contract suite, and a developer who wants it locally runs `pnpm test:contract` with `uv` available. This is acceptable because CI is the enforcement point by design.

## Decision: widen the reader rather than restrict the writer

The 5-part bundle exists because `protspace bundle -s` is a supported flag and statistics are genuine Python-side output. Declaring it out-of-contract would make a working producer feature permanently unopenable in the web application for no gain. The reader instead accepts 3 to 5 parts and ignores anything past settings, matching `_parse_bundle`'s own bounds.

```
-  if (delimiterPositions.length !== 2 && delimiterPositions.length !== 3)
-    throw new Error(`Expected 2 or 3 delimiters in parquetbundle, …`)
+  if (delimiterPositions.length < 2 || delimiterPositions.length > 4)
+    throw new Error(`Expected 2 to 4 delimiters in parquetbundle, …`)
```

The `hasSettingsPart` branch changes from `length === 3` to `length >= 3`, and part 4 is sliced to the next delimiter rather than to end-of-file. The zero-byte settings sentinel must resolve to `settings === null`, not to a parse error.

## Decision: payload over variant count

Four layout variants prove the reader tolerates each shape. They prove nothing about encoding. The generator's ten proteins therefore carry:

| element                    | why it is in the contract                                   |
| -------------------------- | ----------------------------------------------------------- |
| percent-encoded label      | v2 encoding; a v1 reader renders the escape literally       |
| `;` multi-hit cell         | v2 splits it; v1 treats it as one opaque label              |
| numeric column with a null | null versus `NaN` handling differs across the boundary      |
| one 3D projection          | `z` column presence and the `dimensions` metadata field     |
| BigInt-valued `info_json`  | previously caused serialization failures on the reader side |

## CI trigger

```yaml
paths:
  - 'apps/protspace/src/protspace/data/io/**'
  - 'apps/protspace/src/protspace/data/annotations/**'
  - 'apps/protspace/src/protspace/cli/bundle.py'
  - 'packages/core/src/components/data-loader/**'
  - 'packages/utils/src/parquet/**'
  - 'tests/contract/**'
  - '.github/workflows/bundle-contract.yml'
```

The union is the point. `ci.yml` and `protspace-ci.yml` remain mutually exclusive; this workflow is the only one that fires for a change to either side, and it installs both `uv` and pnpm.

## Risks

- **Generator drift.** If `protspace annotate` changes its output columns, the hand-written input parquets keep the contract test green against a stale idea of that stage's output. Narrower than the gap being closed; noted, not solved.
- **Cross-runtime CI cost.** The job installs both toolchains. Mitigated by the path filter — it fires only for changes to the format seam.
- **Subprocess failure legibility.** If `protspace bundle` exits non-zero, the generator must surface its stderr through the vitest failure, or the suite reports an unhelpful missing-file error.

## Deferred follow-up

Three items surfaced during code review, verified as real, and deliberately left
out of this change. They are recorded here rather than as open tasks because each
is a decision to defer, not unfinished work in this change's scope.

### 1. The TypeScript writer has no delimiter guard (correctness)

The Python writer refuses to emit a part containing the reserved delimiter bytes
(`_check_no_delimiter`). `packages/utils/src/parquet/bundle-writer.ts` has no
equivalent, so a web export whose annotation text contains the literal
`---PARQUET_DELIMITER---` produces a bundle with a spurious delimiter.

Widening the reader's part-count gate made this _report_ worse, not more likely:
a contaminated 4-part export previously failed fast with "Expected 2 or 3
delimiters, found 4" and now gets admitted, mis-sliced, and surfaces as "Invalid
Parquet file: magic bytes not found" — a misleading error for a delimiter
problem. A 3-part contaminated export was already mis-admitted before this
change, so the underlying hole predates it.

The real fix is a producer-side guard mirroring the Python one, in the export
path this change does not otherwise touch. Deferred to keep the diff scoped to
the seam.

### 2. A zero-byte settings part in a 4-part bundle no longer warns

`if (part4 && part4.byteLength > 0)` treats an empty settings part as the
producer's sentinel. That is only strictly true when a fifth part follows — the
sentinel exists to hold statistics at a fixed position. In a 4-part bundle a
zero-byte settings part instead means a truncated or failed settings write, and
that case now skips the parser silently where it previously logged "Failed to
parse settings from bundle, using defaults".

Conditioning the skip on `delimiterPositions.length === 4` would restore the
diagnostic. Not done here because it changes reader behavior beyond the layout
this change set out to support, and no producer is known to emit it.

### 3. The contract suite re-decodes each bundle per test

Every `it()` re-reads its bundle from disk and re-runs the full parquet decode;
`minimal` is extracted six times per run. Hoisting each variant's extraction into
`beforeAll` would cut suite CPU several-fold with no loss of coverage. Left alone
because the suite runs in ~3s and per-test extraction keeps each case readable in
isolation — revisit if the suite grows or the large variant gets bigger.
