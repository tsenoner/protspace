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

Three items surfaced during code review and were originally deferred. A later
cleanup pass resolved all three; each entry records what actually happened,
because two of the original write-ups turned out to be wrong about the fix.

### 1. The TypeScript writer has no delimiter guard (correctness) — RESOLVED

The Python writer refuses to emit a part containing the reserved delimiter bytes
(`_check_no_delimiter`). `packages/utils/src/parquet/bundle-writer.ts` had no
equivalent, so a web export whose annotation text contains the literal
`---PARQUET_DELIMITER---` produced a bundle with a spurious delimiter.

The original write-up claimed widening the reader made this _report_ worse but
not more likely. That understated it. A 4-part export contaminated **inside the
settings part** produces 3 real + 1 spurious delimiter: previously a hard
rejection, now admitted, with `part4` truncated at the spurious delimiter,
`extractSettings` failing its magic check, and the failure swallowed into a
`console.warn`. The dataset loads with all styling silently discarded. Settings
JSON carries user-authored legend category names, so this was the most reachable
contamination vector — and a silent wrong result is worse than the loud failure
it replaced.

Fixed by `assertNoBundleDelimiter` in `packages/utils/src/parquet/delimiter-utils.ts`
(the module that already declares itself shared between reader and writer),
applied to every part in `createParquetBundle`. Mutation-verified: removing the
call turns the new `bundle-writer.test.ts` case red, which also confirms the
delimiter genuinely survives into serialized parquet bytes rather than being
hidden by column compression.

The deeper alternative — replacing in-band delimiters with length framing or a
footer offset table — was rejected: it breaks every published `.parquetbundle`
(Swiss-Prot ~45 MB, `apps/web/public/data/`, every user's saved file) for a
hazard a 6-line write-time assertion fully covers.

### 2. A zero-byte settings part in a 4-part bundle no longer warns — WITHDRAWN

The original entry proposed conditioning the skip on `delimiterPositions.length === 4`
to restore a diagnostic. **That fix should not be implemented — it would
reintroduce the exact drift this change exists to eliminate.**

`bundle.py:53` reads `settings = parts[3] if len(parts) >= 4 and parts[3] else None`:
Python branches on the fourth part's **emptiness**, not on the raw part count,
and `bundle.py:9-11` states that as the format rule. The TypeScript
`part4 && part4.byteLength > 0` is a byte-for-byte match of the producer's own
semantics. Conditioning on part count would make the reader branch on something
the writer does not — a new divergence, and one the contract suite could not
catch, since no producer emits the shape it distinguishes.

The lost diagnostic also covers an unreachable state. No writer can produce a
4-part bundle with a zero-byte settings slot: `write_bundle` and
`replace_annotations_in_bundle` emit the empty slot only when statistics follow,
`replace_settings_in_bundle` always writes real bytes, and `createParquetBundle`
pushes settings only when `hasBundleSettings()` is true. Truncated writes are
foreclosed too — Python writes via `_atomic_write_bytes` (tempfile + `os.replace`)
and the web path writes a single `Blob`.

If a truncation diagnostic is ever genuinely wanted, it has to be added to both
sides at once, or it is simply a new drift.

### 3. The contract suite re-decodes each bundle per test — RESOLVED (claim was wrong)

The original entry claimed hoisting into `beforeAll` "would cut suite CPU
several-fold." **That estimate was wrong by roughly three orders of magnitude.**
Measured: the six `minimal` tests total ~7ms of a ~4.3s run; the remaining ~4.2s
is the `beforeAll` generator subprocess. Hoisting saves ~0.14% of wall time.

The extractions in the `annotation encoding` block were hoisted anyway — not for
CPU, but because five verbatim copies of the same two-line preamble is
duplication, and it forced every case to be `async` for a reason unrelated to
what it asserts.

One case must **not** be hoisted, and the reason is worth recording: the
`stats_no_settings` test spies on `console.warn` and asserts it was never called.
Its extraction has to happen inside the test body while the spy is installed.
Hoisting it into `beforeAll` would move the decode before the spy exists and
void the assertion silently — it would pass even with the `byteLength > 0` guard
removed, which is precisely the regression it was written to catch.
